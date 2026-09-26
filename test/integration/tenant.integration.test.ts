import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { testDatabaseReady } from '../helpers/test-environment';
import { createServer } from 'node:http';
import { close, listen } from '../helpers/http-server';
import { hashApiKey } from '../../src/services/security/credentials';

const integrationTest = testDatabaseReady ? test : test.skip;

integrationTest('database enforces tenant-scoped order references and account ownership', async () => {
  const { default: db } = await import('../../src/config/prisma');
  const suffix = `it-${randomUUID()}`;
  const tenantA = await db.client.create({ data: {
    client_id: `tenant-a-${suffix}`, api_key_hash: `hash-a-${suffix}`, callback_url: 'https://tenant-a.test/callback',
    redirect_uri: 'https://tenant-a.test/return', webhook_secret: 'secret-a',
  } });
  const tenantB = await db.client.create({ data: {
    client_id: `tenant-b-${suffix}`, api_key_hash: `hash-b-${suffix}`, callback_url: 'https://tenant-b.test/callback',
    redirect_uri: 'https://tenant-b.test/return', webhook_secret: 'secret-b',
  } });
  const vendorA = await db.vendor.create({ data: { client_id: tenantA.id, mp_access_token: 'token-a', v2_active: true } });
  const vendorB = await db.vendor.create({ data: { client_id: tenantB.id, mp_access_token: 'token-b', v2_active: true } });

  try {
    const order = await db.order.create({ data: {
      client_id: tenantA.id, vendor_id: vendorA.id, external_id: `order-${suffix}`,
      monto: '100.00', moneda: 'ARS', concepto: 'Integration fixture',
    } });
    await assert.rejects(db.order.create({ data: {
      client_id: tenantA.id, vendor_id: vendorA.id, external_id: order.external_id,
      monto: '100.00', moneda: 'ARS', concepto: 'Duplicate reference',
    } }), { code: 'P2002' });
    const sameReferenceOtherTenant = await db.order.create({ data: {
      client_id: tenantB.id, vendor_id: vendorB.id, external_id: order.external_id,
      monto: '100.00', moneda: 'ARS', concepto: 'Separate tenant reference',
    } });
    assert.equal(sameReferenceOtherTenant.client_id, tenantB.id);
    await assert.rejects(db.order.create({ data: {
      client_id: tenantA.id, vendor_id: vendorB.id, external_id: `cross-${suffix}`,
      monto: '100.00', moneda: 'ARS', concepto: 'Cross tenant account',
    } }));
  } finally {
    await db.order.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.vendor.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.client.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  }
});

integrationTest('OAuth state is scoped, expires, and can be consumed only once', async () => {
  const { default: db } = await import('../../src/config/prisma');
  const { createOAuthState, consumeOAuthState } = await import('../../src/services/mercadopago/oauth.service');
  const suffix = `oauth-${randomUUID()}`;
  const tenant = await db.client.create({ data: {
    client_id: suffix, api_key_hash: `hash-${suffix}`, callback_url: 'https://tenant.test/callback',
    redirect_uri: 'https://tenant.test/return', webhook_secret: 'secret',
  } });
  try {
    const now = new Date();
    const state = await createOAuthState(tenant.id, now);
    const consumed = await consumeOAuthState(state, new Date(now.getTime() + 1_000));
    assert.equal(consumed?.client_id, tenant.id);
    assert.equal(await consumeOAuthState(state, new Date(now.getTime() + 2_000)), null);

    const expiringState = await createOAuthState(tenant.id, now);
    assert.equal(await consumeOAuthState(expiringState, new Date(now.getTime() + 11 * 60_000)), null);

    const concurrentState = await createOAuthState(tenant.id, now);
    const concurrentConsumers = await Promise.all([
      consumeOAuthState(concurrentState, new Date(now.getTime() + 1_000)),
      consumeOAuthState(concurrentState, new Date(now.getTime() + 1_000)),
    ]);
    assert.equal(concurrentConsumers.filter(Boolean).length, 1);
  } finally {
    await db.oAuthState.deleteMany({ where: { client_id: tenant.id } });
    await db.client.delete({ where: { id: tenant.id } });
  }
});

integrationTest('a payment row cannot reference an order or vendor owned by another tenant', async () => {
  const { default: db } = await import('../../src/config/prisma');
  const suffix = `payment-${randomUUID()}`;
  const tenantA = await db.client.create({ data: {
    client_id: `a-${suffix}`, api_key_hash: `ha-${suffix}`, callback_url: 'https://a.test/cb', redirect_uri: 'https://a.test', webhook_secret: 'a',
  } });
  const tenantB = await db.client.create({ data: {
    client_id: `b-${suffix}`, api_key_hash: `hb-${suffix}`, callback_url: 'https://b.test/cb', redirect_uri: 'https://b.test', webhook_secret: 'b',
  } });
  const vendorA = await db.vendor.create({ data: { client_id: tenantA.id, mp_access_token: 'a' } });
  const vendorB = await db.vendor.create({ data: { client_id: tenantB.id, mp_access_token: 'b' } });
  const orderA = await db.order.create({ data: {
    client_id: tenantA.id, vendor_id: vendorA.id, external_id: suffix, monto: '12.00', moneda: 'ARS', concepto: 'Fixture',
  } });
  try {
    await assert.rejects(db.payment.create({ data: {
      client_id: tenantA.id, vendor_id: vendorB.id, order_id: orderA.id,
      idempotency_key: suffix, request_fingerprint: 'fingerprint', provider_idempotency_key: `provider-${suffix}`,
      monto: '12.00', moneda: 'ARS',
    } }));
  } finally {
    await db.callbackDelivery.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.webhookEvent.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.payment.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.order.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.vendor.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.client.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  }
});

integrationTest('API keys expose only the active account and orders of their own tenant', async () => {
  const { default: db } = await import('../../src/config/prisma');
  const { app } = await import('../../src/app');
  const suffix = `scope-${randomUUID()}`;
  const apiKeyA = `api-a-${suffix}`;
  const apiKeyB = `api-b-${suffix}`;
  const tenantA = await db.client.create({ data: {
    client_id: `scope-a-${suffix}`, api_key_hash: hashApiKey(apiKeyA), callback_url: 'https://a.test/cb',
    redirect_uri: 'https://a.test', webhook_secret: 'a',
  } });
  const tenantB = await db.client.create({ data: {
    client_id: `scope-b-${suffix}`, api_key_hash: hashApiKey(apiKeyB), callback_url: 'https://b.test/cb',
    redirect_uri: 'https://b.test', webhook_secret: 'b',
  } });
  const vendorA = await db.vendor.create({ data: {
    client_id: tenantA.id, v2_active: true, mp_user_id: `mp-${suffix}`, mp_access_token: 'must-not-be-returned',
    mp_public_key: `public-${suffix}`,
  } });
  const orderA = await db.order.create({ data: {
    client_id: tenantA.id, vendor_id: vendorA.id, external_id: suffix, monto: '50.00', moneda: 'ARS', concepto: 'Scoped order',
  } });
  const server = createServer(app);
  const baseUrl = await listen(server);
  try {
    const accountA = await fetch(`${baseUrl}/v2/auth/account`, { headers: { 'x-api-key': apiKeyA } });
    assert.deepEqual(await accountA.json(), { connected: true, public_key: `public-${suffix}`, expires_at: null });

    const accountB = await fetch(`${baseUrl}/v2/auth/account`, { headers: { 'x-api-key': apiKeyB } });
    assert.deepEqual(await accountB.json(), { connected: false, public_key: null, expires_at: null });

    const crossTenantOrder = await fetch(`${baseUrl}/v2/ordenes/${orderA.id}/estado`, { headers: { 'x-api-key': apiKeyB } });
    assert.equal(crossTenantOrder.status, 404);
  } finally {
    await close(server);
    await db.callbackDelivery.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.webhookEvent.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.payment.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.order.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.vendor.deleteMany({ where: { client_id: { in: [tenantA.id, tenantB.id] } } });
    await db.client.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  }
});

integrationTest('a tenant cannot activate two Mercado Pago accounts for V2 at once', async () => {
  const { default: db } = await import('../../src/config/prisma');
  const suffix = `active-${randomUUID()}`;
  const tenant = await db.client.create({ data: {
    client_id: suffix, api_key_hash: `hash-${suffix}`, callback_url: 'https://tenant.test/callback',
    redirect_uri: 'https://tenant.test/return', webhook_secret: 'secret',
  } });
  const first = await db.vendor.create({ data: { client_id: tenant.id, mp_access_token: 'first-token', v2_active: true } });
  try {
    await assert.rejects(db.vendor.create({ data: { client_id: tenant.id, mp_access_token: 'second-token', v2_active: true } }));
  } finally {
    await db.vendor.deleteMany({ where: { client_id: tenant.id } });
    await db.client.delete({ where: { id: tenant.id } });
  }
  assert.ok(first.id > 0);
});

integrationTest('concurrent retries with one idempotency key persist one payment and reuse one provider key', async () => {
  const { default: db } = await import('../../src/config/prisma');
  const { createBrickPayment, parseBrickPaymentInput } = await import('../../src/services/payments/brick-payment.service');
  const { encryptSecret } = await import('../../src/services/security/secret-crypto');
  const suffix = `idem-${randomUUID()}`;
  const tenant = await db.client.create({ data: {
    client_id: suffix, api_key_hash: `hash-${suffix}`, callback_url: 'https://tenant.test/callback',
    redirect_uri: 'https://tenant.test/return',
    webhook_secret: encryptSecret('tenant-webhook-secret', process.env.TOKEN_ENCRYPTION_KEY!),
  } });
  await db.vendor.create({ data: {
    client_id: tenant.id, mp_access_token: encryptSecret('access-token', process.env.TOKEN_ENCRYPTION_KEY!),
    mp_user_id: `mp-${suffix}`, v2_active: true,
  } });
  const input = parseBrickPaymentInput({
    external_id: `external-${suffix}`, concepto: 'Concurrent retry test', transaction_amount: 77.25,
    currency_id: 'ARS', token: 'temporary-brick-token', installments: 1, payment_method_id: 'visa',
    payer: { email: 'buyer@example.test' },
  });
  const providerKeys = new Set<string>();
  const providerFetch: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    providerKeys.add(headers.get('X-Idempotency-Key') ?? '');
    const requestBody = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response(JSON.stringify({
      id: `provider-${suffix}`, status: 'approved', status_detail: 'accredited', collector_id: `mp-${suffix}`,
      transaction_amount: requestBody.transaction_amount, currency_id: 'ARS',
      external_reference: requestBody.external_reference,
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const tenantIdentity = { id: tenant.id, client_id: tenant.client_id, callback_url: tenant.callback_url, webhook_secret: tenant.webhook_secret };
  try {
    const results = await Promise.all([
      createBrickPayment(tenantIdentity, input, `key-${suffix}`, db, providerFetch),
      createBrickPayment(tenantIdentity, input, `key-${suffix}`, db, providerFetch),
    ]);
    assert.equal(results[0].id_pago, results[1].id_pago);
    assert.equal(await db.payment.count({ where: { client_id: tenant.id, idempotency_key: `key-${suffix}` } }), 1);
    assert.equal(providerKeys.size, 1);
    assert.notEqual([...providerKeys][0], '');
  } finally {
    await db.callbackDelivery.deleteMany({ where: { client_id: tenant.id } });
    await db.webhookEvent.deleteMany({ where: { client_id: tenant.id } });
    await db.payment.deleteMany({ where: { client_id: tenant.id } });
    await db.order.deleteMany({ where: { client_id: tenant.id } });
    await db.vendor.deleteMany({ where: { client_id: tenant.id } });
    await db.client.delete({ where: { id: tenant.id } });
  }
});
