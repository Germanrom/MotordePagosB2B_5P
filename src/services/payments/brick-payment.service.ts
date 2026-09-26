import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../config/prisma';
import { decryptConfiguredSecret } from '../security/secret-crypto';
import { fingerprintRequest } from '../security/credentials';
import { assertPaymentMatchesOrder, normalizePaymentStatus } from './reconciliation';
import { enqueuePaymentCallback } from './callback-outbox.service';
import { mercadoPagoApiUrl } from '../mercadopago/api-url';

const paymentDataSchema = z.object({
  external_id: z.string().trim().min(1).max(128),
  concepto: z.string().trim().min(1).max(256),
  transaction_amount: z.number().positive().max(100_000_000).refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7, 'Amount must have at most two decimal places'),
  currency_id: z.literal('ARS').default('ARS'),
  token: z.string().min(1).max(512),
  installments: z.number().int().min(1).max(24),
  payment_method_id: z.string().min(1).max(64),
  issuer_id: z.union([z.string().max(64), z.number().int()]).nullable().optional(),
  payer: z.object({
    email: z.string().email().max(254),
    identification: z.object({ type: z.string().max(16), number: z.string().max(32) }).strict().optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
  }).strict(),
}).strict();

export type BrickPaymentInput = z.infer<typeof paymentDataSchema>;

export class PaymentOperationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

type TenantIdentity = { id: string; client_id: string; callback_url: string; webhook_secret: string };
type ProviderFetch = typeof fetch;

const decimalToCents = (amount: string | number): bigint => {
  const [units, cents = ''] = String(amount).split('.');
  return BigInt(units) * 100n + BigInt(cents.padEnd(2, '0').slice(0, 2));
};

const createOrder = async (
  db: PrismaClient,
  tenantId: string,
  vendorId: number,
  input: BrickPaymentInput,
): Promise<Awaited<ReturnType<PrismaClient['order']['findFirstOrThrow']>>> => {
  const existing = await db.order.findFirst({ where: { client_id: tenantId, external_id: input.external_id } });
  if (existing) {
    if (existing.vendor_id !== vendorId) throw new PaymentOperationError(409, 'external_id_account_conflict', 'external_id is already assigned to a different Mercado Pago account');
    if (decimalToCents(existing.monto.toString()) !== decimalToCents(input.transaction_amount)
      || existing.moneda !== input.currency_id || existing.concepto !== input.concepto) {
      throw new PaymentOperationError(409, 'external_id_conflict', 'external_id already exists with different order details');
    }
    return existing;
  }

  try {
    return await db.order.create({
      data: {
        client_id: tenantId,
        vendor_id: vendorId,
        external_id: input.external_id,
        monto: new Prisma.Decimal(input.transaction_amount.toFixed(2)),
        moneda: input.currency_id,
        concepto: input.concepto,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const raced = await db.order.findFirst({ where: { client_id: tenantId, external_id: input.external_id } });
    if (!raced) throw error;
    if (raced.vendor_id !== vendorId) throw new PaymentOperationError(409, 'external_id_account_conflict', 'external_id is already assigned to a different Mercado Pago account');
    if (decimalToCents(raced.monto.toString()) !== decimalToCents(input.transaction_amount)
      || raced.moneda !== input.currency_id || raced.concepto !== input.concepto) {
      throw new PaymentOperationError(409, 'external_id_conflict', 'external_id already exists with different order details');
    }
    return raced;
  }
};

export const parseBrickPaymentInput = (value: unknown): BrickPaymentInput => {
  const result = paymentDataSchema.safeParse(value);
  if (!result.success) throw new PaymentOperationError(422, 'validation_error', 'Invalid Brick payment data');
  return result.data;
};

export const createBrickPayment = async (
  tenant: TenantIdentity,
  input: BrickPaymentInput,
  idempotencyKey: string,
  db: PrismaClient = prisma,
  providerFetch: ProviderFetch = fetch,
) => {
  const key = idempotencyKey.trim();
  if (!key || key.length > 128) throw new PaymentOperationError(400, 'idempotency_key_required', 'Idempotency-Key header is required and must be at most 128 characters');
  const requestFingerprint = fingerprintRequest(input);

  let payment = await db.payment.findUnique({
    where: { client_id_idempotency_key: { client_id: tenant.id, idempotency_key: key } },
    include: { order: true, vendor: true },
  });
  let paymentWasCreated = false;
  if (payment && payment.request_fingerprint !== requestFingerprint) {
    throw new PaymentOperationError(409, 'idempotency_conflict', 'Idempotency-Key was already used with different payment data');
  }
  if (payment?.provider_payment_id) return paymentResponse(payment);

  let vendor = payment?.vendor ?? await db.vendor.findFirst({ where: { client_id: tenant.id, v2_active: true } });
  if (!vendor) throw new PaymentOperationError(409, 'mp_account_not_connected', 'Tenant has no active Mercado Pago account for V2');
  if (vendor.client_id !== tenant.id) throw new PaymentOperationError(404, 'mp_account_not_connected', 'Active payment account was not found');
  if (vendor.mp_expires_at && vendor.mp_expires_at.getTime() <= Date.now()) {
    throw new PaymentOperationError(409, 'mp_account_reauthorization_required', 'Mercado Pago account authorization has expired');
  }

  const order = payment?.order ?? await createOrder(db, tenant.id, vendor.id, input);
  if (order.vendor_id !== vendor.id || order.client_id !== tenant.id) {
    throw new PaymentOperationError(409, 'order_account_conflict', 'Order is not assigned to the active payment account');
  }

  if (!payment) {
    try {
      payment = await db.payment.create({
        data: {
          client_id: tenant.id,
          vendor_id: vendor.id,
          order_id: order.id,
          idempotency_key: key,
          request_fingerprint: requestFingerprint,
          provider_idempotency_key: randomUUID(),
          monto: new Prisma.Decimal(input.transaction_amount.toFixed(2)),
          moneda: input.currency_id,
        },
        include: { order: true, vendor: true },
      });
      paymentWasCreated = true;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      payment = await db.payment.findUnique({
        where: { client_id_idempotency_key: { client_id: tenant.id, idempotency_key: key } },
        include: { order: true, vendor: true },
      });
      if (!payment || payment.request_fingerprint !== requestFingerprint) {
        throw new PaymentOperationError(409, 'idempotency_conflict', 'Idempotency-Key was concurrently used by a different request');
      }
      if (payment.provider_payment_id) return paymentResponse(payment);
    }
  }

  const accessToken = decryptConfiguredSecret(vendor.mp_access_token);
  if (!vendor.mp_user_id) {
    let accountResponse: Response;
    try {
      accountResponse = await providerFetch(mercadoPagoApiUrl('/users/me'), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PaymentOperationError(502, 'mp_account_verification_failed', 'Could not verify the linked Mercado Pago account');
    }
    const account = await accountResponse.json().catch(() => null) as Record<string, unknown> | null;
    const accountId = account?.id === undefined ? '' : String(account.id);
    if (!accountResponse.ok || !accountId) throw new PaymentOperationError(409, 'mp_account_reauthorization_required', 'The linked Mercado Pago account could not be verified; reconnect it with OAuth');
    try {
      vendor = await db.vendor.update({ where: { id: vendor.id }, data: { mp_user_id: accountId } });
    } catch {
      throw new PaymentOperationError(409, 'mp_account_conflict', 'This Mercado Pago account is already linked to another tenant');
    }
  }
  if (!vendor.mp_user_id) throw new PaymentOperationError(409, 'mp_account_reauthorization_required', 'The linked Mercado Pago account could not be verified; reconnect it with OAuth');
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:8000';
  const notificationUrl = new URL('/v2/webhook/mercadopago', baseUrl);
  notificationUrl.searchParams.set('account_id', String(vendor.id));
  const body: Record<string, unknown> = {
    token: input.token,
    transaction_amount: input.transaction_amount,
    installments: input.installments,
    payment_method_id: input.payment_method_id,
    payer: input.payer,
    external_reference: order.id,
    notification_url: notificationUrl.toString(),
  };
  if (input.issuer_id !== undefined && input.issuer_id !== null) body.issuer_id = input.issuer_id;

  let response: Response;
  try {
    response = await providerFetch(mercadoPagoApiUrl('/v1/payments'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': payment.provider_idempotency_key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new PaymentOperationError(502, 'payment_provider_unavailable', 'Mercado Pago could not be reached; the same request can be retried safely');
  }

  const providerPayment = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!providerPayment || typeof providerPayment.id !== 'number' && typeof providerPayment.id !== 'string') {
    throw new PaymentOperationError(502, 'payment_provider_error', 'Mercado Pago did not return a payment resource');
  }

  try {
    assertPaymentMatchesOrder({
      vendorId: vendor.id,
      amount: order.monto.toString(),
      currency: order.moneda,
      externalReference: order.id,
    }, {
      collectorId: String(providerPayment.collector_id ?? ''),
      transactionAmount: String(providerPayment.transaction_amount ?? ''),
      currencyId: String(providerPayment.currency_id ?? ''),
      externalReference: String(providerPayment.external_reference ?? ''),
    }, vendor.mp_user_id);
  } catch {
    throw new PaymentOperationError(502, 'payment_provider_mismatch', 'Mercado Pago returned a payment that does not match this tenant order');
  }

  const providerStatus = String(providerPayment.status ?? '');
  const status = normalizePaymentStatus(providerStatus);
  if (!status) throw new PaymentOperationError(502, 'payment_provider_status_unsupported', 'Mercado Pago returned an unsupported payment status; retry with the same Idempotency-Key');
  const paymentId = String(providerPayment.id);
  const collectorId = String(providerPayment.collector_id ?? '');
  if (!collectorId) throw new PaymentOperationError(502, 'payment_provider_mismatch', 'Mercado Pago response omitted the collector account');
  payment = await db.$transaction(async (tx) => {
    const transitionFrom = payment!.estado;
    const updated = await tx.payment.update({
      where: { id: payment!.id },
      data: { provider_payment_id: paymentId, estado: status, status_detail: String(providerPayment.status_detail ?? '') || null },
      include: { order: true, vendor: true },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { last_payment_id: updated.id, mp_payment_id: paymentId, estado: status },
    });
    if (transitionFrom !== status || paymentWasCreated) {
      await enqueuePaymentCallback(tx, { ...order, estado: status }, updated, tenant, paymentWasCreated ? 'CREATED' : transitionFrom);
    }
    return updated;
  });

  if (!response.ok && status === 'PENDING') {
    throw new PaymentOperationError(422, 'payment_not_accepted', 'Mercado Pago did not accept the payment request');
  }
  return paymentResponse(payment);
};

export const getTenantOrderStatus = async (tenantId: string, orderId: string, db: PrismaClient = prisma) => {
  const order = await db.order.findFirst({
    where: { id: orderId, client_id: tenantId },
    include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!order) return null;
  const latest = order.payments[0];
  return {
    id_orden: order.id,
    external_id: order.external_id,
    estado: order.estado,
    mp_payment_id: order.mp_payment_id,
    updated_at: order.updatedAt,
    ultimo_pago: latest ? { id_pago: latest.id, estado: latest.estado, status_detail: latest.status_detail, mp_payment_id: latest.provider_payment_id } : null,
  };
};

const paymentResponse = (payment: {
  id: string;
  estado: string;
  status_detail: string | null;
  provider_payment_id: string | null;
  order: { id: string; external_id: string };
}) => ({
  id_pago: payment.id,
  id_orden: payment.order.id,
  external_id: payment.order.external_id,
  estado: payment.estado.toLowerCase(),
  status_detail: payment.status_detail,
  mp_payment_id: payment.provider_payment_id,
});
