import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assertProviderCheckoutMatches, createSubscriptionCheckout, parseCheckoutInput, SubscriptionOperationError } from '../../src/services/subscriptions/subscription-checkout.service';
import { encryptSecret } from '../../src/services/security/secret-crypto';

const input = () => ({
  external_tenant_id: 'company-1', plan_code: 'pro', plan_version: '2026-10', amount: '25000.00', currency: 'ARS',
  payer_email: 'payer@example.com',
  terms: { description: 'Monthly Pro', billing_day: 5, terms_url: 'https://app.example.com/terms' },
  return_url: 'https://app.example.com/return',
});

test('subscription checkout input requires backend plan terms and rejects arbitrary fields', () => {
  assert.equal(parseCheckoutInput(input()).amount, '25000.00');
  for (const invalid of [
    { ...input(), amount: '0.00' },
    { ...input(), amount: '1.001' },
    { ...input(), currency: 'USD' },
    { ...input(), terms: { ...input().terms, billing_day: 6 } },
    { ...input(), return_url: 'http://app.example.com/return' },
    { ...input(), vendor_id: 1 },
  ]) assert.throws(() => parseCheckoutInput(invalid), SubscriptionOperationError);
});

test('provider checkout must match FivePeaks account, local reference, amount, and currency', () => {
  const local = { id: 'local-subscription', amount: new Prisma.Decimal('100.00'), currency: 'ARS', payer_email: 'payer@example.com' };
  const provider = { id: 'mp-1', collector_id: 123, external_reference: local.id, payer_email: local.payer_email,
    init_point: 'https://www.mercadopago.com.ar/checkout', auto_recurring: { transaction_amount: '100.00', currency_id: 'ARS' } };
  assert.doesNotThrow(() => assertProviderCheckoutMatches(provider, local, '123'));
  for (const changed of [
    { ...provider, collector_id: 999 },
    { ...provider, external_reference: 'other-subscription' },
    { ...provider, auto_recurring: { ...provider.auto_recurring, transaction_amount: '101.00' } },
    { ...provider, auto_recurring: { ...provider.auto_recurring, currency_id: 'USD' } },
  ]) assert.throws(() => assertProviderCheckoutMatches(changed, local, '123'), SubscriptionOperationError);
});

test('checkout uses FivePeaks credentials, persists the provider ID, and returns the same checkout on retry', async () => {
  const old = Object.fromEntries(['SAAS_SUBSCRIPTIONS_CHECKOUT_ENABLED', 'TOKEN_ENCRYPTION_KEY', 'MP_SAAS_ACCESS_TOKEN_ENCRYPTED', 'MP_SAAS_COLLECTOR_ID', 'MP_API_BASE_URL'].map((key) => [key, process.env[key]]));
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  process.env.SAAS_SUBSCRIPTIONS_CHECKOUT_ENABLED = 'true';
  process.env.TOKEN_ENCRYPTION_KEY = encryptionKey;
  process.env.MP_SAAS_ACCESS_TOKEN_ENCRYPTED = encryptSecret('TEST-fivepeaks-token', encryptionKey);
  process.env.MP_SAAS_COLLECTOR_ID = '123';
  process.env.MP_API_BASE_URL = 'https://provider.example.test';

  let row: Record<string, any> | null = null;
  let posts = 0;
  const db = { saasSubscription: {
    findUnique: async () => row,
    create: async ({ data }: any) => { row = { ...data, id: 'subscription-uuid', amount: new Prisma.Decimal(data.amount), provider_preapproval_id: null, checkout_url: null }; return row; },
    update: async ({ data }: any) => { row = { ...row, ...data }; return row; },
    updateMany: async ({ data }: any) => { row = { ...row, ...data }; return { count: 1 }; },
  } } as unknown as PrismaClient;
  const providerFetch = (async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), 'https://provider.example.test/preapproval');
    assert.equal(options?.headers && (options.headers as Record<string, string>).Authorization, 'Bearer TEST-fivepeaks-token');
    posts++;
    const sent = JSON.parse(String(options?.body));
    assert.equal(sent.external_reference, 'subscription-uuid');
    assert.equal(sent.status, 'pending');
    return new Response(JSON.stringify({
      id: 'mp-preapproval-1', collector_id: 123, external_reference: 'subscription-uuid', status: 'pending',
      payer_email: 'payer@example.com', init_point: 'https://www.mercadopago.com.ar/checkout',
      auto_recurring: { transaction_amount: '25000.00', currency_id: 'ARS' },
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const client = { id: 'client-1', redirect_uri: 'https://app.example.com/oauth', subscription_callback_url: 'https://app.example.com/subscription-callback' };
    const first = await createSubscriptionCheckout(client, parseCheckoutInput(input()), 'key-1', db, providerFetch);
    const repeat = await createSubscriptionCheckout(client, parseCheckoutInput(input()), 'key-1', db, providerFetch);
    assert.deepEqual(repeat, first);
    assert.equal(first.status, 'pending_checkout');
    assert.equal(first.init_point, 'https://www.mercadopago.com.ar/checkout');
    assert.equal(posts, 1);
    assert.equal(row?.provider_preapproval_id, 'mp-preapproval-1');
    await assert.rejects(createSubscriptionCheckout(client, parseCheckoutInput({ ...input(), amount: '26000.00' }), 'key-1', db, providerFetch),
      (error: unknown) => error instanceof SubscriptionOperationError && error.code === 'idempotency_conflict');

    row = null;
    let uncertainPosts = 0;
    const uncertainProvider = (async (_url: string | URL | Request, options?: RequestInit) => {
      if (options?.method === 'POST') { uncertainPosts++; throw new Error('network timeout after POST'); }
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    await assert.rejects(createSubscriptionCheckout(client, parseCheckoutInput(input()), 'key-2', db, uncertainProvider),
      (error: unknown) => error instanceof SubscriptionOperationError && error.code === 'subscription_provider_unavailable');
    await assert.rejects(createSubscriptionCheckout(client, parseCheckoutInput(input()), 'key-2', db, uncertainProvider),
      (error: unknown) => error instanceof SubscriptionOperationError && error.code === 'subscription_reconciliation_required');
    assert.equal(uncertainPosts, 1, 'retry must not issue another create request');
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
