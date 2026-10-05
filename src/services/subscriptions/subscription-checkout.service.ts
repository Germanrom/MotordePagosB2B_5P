import { Prisma, PrismaClient, type SaasSubscription } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../config/prisma';
import { mercadoPagoApiUrl } from '../mercadopago/api-url';
import { fingerprintRequest } from '../security/credentials';
import { decryptConfiguredSecret } from '../security/secret-crypto';

const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:');
const checkoutSchema = z.object({
  external_tenant_id: z.string().trim().min(1).max(128),
  plan_code: z.string().trim().min(1).max(128),
  plan_version: z.string().trim().min(1).max(64),
  amount: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).refine((amount) => new Prisma.Decimal(amount).gt(0)),
  currency: z.literal('ARS'),
  payer_email: z.email().max(254),
  terms: z.object({
    description: z.string().trim().min(1).max(256),
    billing_day: z.literal(5),
    terms_url: httpsUrl,
  }).strict(),
  return_url: httpsUrl,
}).strict();

export type CheckoutInput = z.infer<typeof checkoutSchema>;
type ClientIdentity = { id: string; redirect_uri: string; subscription_callback_url: string | null };
type MpSubscription = Record<string, any>;
type ProviderFetch = typeof fetch;

export class SubscriptionOperationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export const parseCheckoutInput = (value: unknown): CheckoutInput => {
  const result = checkoutSchema.safeParse(value);
  if (!result.success) throw new SubscriptionOperationError(422, 'validation_error', 'Invalid subscription checkout data');
  return result.data;
};

const providerToken = (): string => {
  const encrypted = process.env.MP_SAAS_ACCESS_TOKEN_ENCRYPTED;
  if (!encrypted?.startsWith('enc:v1:')) throw new SubscriptionOperationError(503, 'saas_credentials_unavailable', 'FivePeaks subscription credentials are not configured');
  return decryptConfiguredSecret(encrypted);
};

const expectedCollector = (): string => {
  const id = process.env.MP_SAAS_COLLECTOR_ID;
  if (!id || !/^\d+$/.test(id)) throw new SubscriptionOperationError(503, 'saas_credentials_unavailable', 'FivePeaks collector ID is not configured');
  return id;
};

const requestProvider = async (path: string, token: string, providerFetch: ProviderFetch, options?: { method: string; body: unknown }): Promise<MpSubscription> => {
  const response = await providerFetch(mercadoPagoApiUrl(path), {
    method: options?.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: options ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new SubscriptionOperationError(502, 'subscription_provider_error', `Mercado Pago returned ${response.status}`);
  return await response.json() as MpSubscription;
};

export const assertProviderCheckoutMatches = (provider: MpSubscription, local: Pick<SaasSubscription, 'id' | 'amount' | 'currency' | 'payer_email'>, collectorId: string): void => {
  const price = provider.auto_recurring?.transaction_amount;
  const point = provider.init_point;
  if (String(provider.collector_id ?? '') !== collectorId
    || String(provider.external_reference ?? '') !== local.id
    || String(provider.auto_recurring?.currency_id ?? '') !== local.currency
    || price === undefined || !new Prisma.Decimal(String(price)).eq(local.amount)
    || typeof provider.id !== 'string' || !provider.id
    || typeof point !== 'string' || !point.startsWith('https://')
    || (provider.payer_email && String(provider.payer_email).toLowerCase() !== local.payer_email.toLowerCase())) {
    throw new SubscriptionOperationError(502, 'subscription_provider_mismatch', 'Mercado Pago checkout does not match the FivePeaks subscription');
  }
};

const resultFor = (subscription: SaasSubscription) => ({
  subscription_id: subscription.id,
  external_tenant_id: subscription.external_tenant_id,
  status: subscription.status.toLowerCase(),
  init_point: subscription.checkout_url,
});

export const createSubscriptionCheckout = async (
  client: ClientIdentity,
  input: CheckoutInput,
  rawKey: string,
  db: PrismaClient = prisma,
  providerFetch: ProviderFetch = fetch,
) => {
  if (process.env.SAAS_SUBSCRIPTIONS_CHECKOUT_ENABLED !== 'true') {
    throw new SubscriptionOperationError(503, 'subscriptions_not_enabled', 'Subscription checkout is awaiting provider calendar validation');
  }
  const key = rawKey.trim();
  if (!key || key.length > 128) throw new SubscriptionOperationError(400, 'idempotency_key_required', 'Idempotency-Key is required and must be at most 128 characters');
  if (!client.subscription_callback_url) throw new SubscriptionOperationError(409, 'subscription_callback_missing', 'The app has no subscription callback URL');
  if (new URL(input.return_url).origin !== new URL(client.redirect_uri).origin) {
    throw new SubscriptionOperationError(422, 'return_url_not_allowed', 'return_url must share the configured app origin');
  }
  const token = providerToken();
  const collectorId = expectedCollector();
  const fingerprint = fingerprintRequest(input);
  let subscription = await db.saasSubscription.findUnique({ where: { client_id_idempotency_key: { client_id: client.id, idempotency_key: key } } });
  if (subscription && subscription.request_fingerprint !== fingerprint) {
    throw new SubscriptionOperationError(409, 'idempotency_conflict', 'Idempotency-Key was already used with different data');
  }
  if (subscription?.provider_preapproval_id) return resultFor(subscription);

  let createdHere = false;
  if (!subscription) {
    try {
      subscription = await db.saasSubscription.create({ data: {
        client_id: client.id,
        external_tenant_id: input.external_tenant_id,
        idempotency_key: key,
        request_fingerprint: fingerprint,
        plan_code: input.plan_code,
        plan_version: input.plan_version,
        terms_snapshot: input.terms,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        payer_email: input.payer_email,
        status: 'CREATING',
      } });
      createdHere = true;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      subscription = await db.saasSubscription.findUnique({ where: { client_id_idempotency_key: { client_id: client.id, idempotency_key: key } } });
      if (!subscription) throw new SubscriptionOperationError(409, 'subscription_already_open', 'This app and tenant already have an open subscription');
      if (subscription.request_fingerprint !== fingerprint) throw new SubscriptionOperationError(409, 'idempotency_conflict', 'Idempotency-Key was already used with different data');
      if (subscription.provider_preapproval_id) return resultFor(subscription);
    }
  }

  if (!createdHere) {
    // A timeout may mean MP accepted the first POST. Search before considering any recovery.
    try {
      const search = await requestProvider(`/preapproval/search?payer_email=${encodeURIComponent(input.payer_email)}`, token, providerFetch);
      const matches = (Array.isArray(search.results) ? search.results : []).filter((row: MpSubscription) => String(row.external_reference ?? '') === subscription!.id);
      if (matches.length === 1) {
        const found = await requestProvider(`/preapproval/${encodeURIComponent(String(matches[0].id))}`, token, providerFetch);
        assertProviderCheckoutMatches(found, subscription!, collectorId);
        subscription = await db.saasSubscription.update({ where: { id: subscription!.id }, data: {
          provider_preapproval_id: String(found.id), checkout_url: String(found.init_point), provider_status: String(found.status ?? ''), status: 'PENDING_CHECKOUT',
        } });
        return resultFor(subscription);
      }
    } catch (error) {
      if (error instanceof SubscriptionOperationError && error.code === 'subscription_provider_mismatch') throw error;
    }
    throw new SubscriptionOperationError(202, 'subscription_reconciliation_required', 'Checkout creation is pending provider reconciliation');
  }

  try {
    // Pending checkout without an MP plan is provisional until phase 0 validates billing dates.
    const provider = await requestProvider('/preapproval', token, providerFetch, { method: 'POST', body: {
      reason: input.terms.description,
      external_reference: subscription!.id,
      payer_email: input.payer_email,
      back_url: input.return_url,
      status: 'pending',
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: Number(input.amount), currency_id: input.currency },
    } });
    assertProviderCheckoutMatches(provider, subscription!, collectorId);
    subscription = await db.saasSubscription.update({ where: { id: subscription!.id }, data: {
      provider_preapproval_id: String(provider.id), checkout_url: String(provider.init_point), provider_status: String(provider.status ?? ''), status: 'PENDING_CHECKOUT',
    } });
    return resultFor(subscription);
  } catch (error) {
    await db.saasSubscription.updateMany({ where: { id: subscription!.id, status: 'CREATING' }, data: { status: 'RECONCILIATION_REQUIRED' } });
    if (error instanceof SubscriptionOperationError) throw error;
    throw new SubscriptionOperationError(502, 'subscription_provider_unavailable', 'Mercado Pago checkout creation is uncertain; retry this request to reconcile');
  }
};

export const getSubscriptionForClient = (clientId: string, id: string, db: PrismaClient = prisma) =>
  db.saasSubscription.findFirst({ where: { id, client_id: clientId }, include: { periods: { orderBy: { period_start: 'desc' }, take: 1 } } });
