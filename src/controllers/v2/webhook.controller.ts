import { Request, Response } from 'express';
import axios from 'axios';
import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../config/prisma';
import { validateMpWebhookSignature } from '../../services/mercadopago/webhook-signature';
import { decryptConfiguredSecret } from '../../services/security/secret-crypto';
import { assertPaymentMatchesOrder, normalizePaymentStatus } from '../../services/payments/reconciliation';
import { enqueuePaymentCallback } from '../../services/payments/callback-outbox.service';
import { mercadoPagoApiUrl } from '../../services/mercadopago/api-url';

const retryDelay = (attempt: number) => new Date(Date.now() + Math.min(3600, 2 ** Math.min(attempt, 10)) * 1000);

export const processStoredPaymentEvent = async (eventId: string, db: PrismaClient = prisma): Promise<void> => {
  let event = await db.webhookEvent.findUnique({ where: { id: eventId }, include: { vendor: { include: { client: true } } } });
  if (!event) return;
  if (!event.vendor.mp_user_id) {
    const accountResponse = await axios.get(mercadoPagoApiUrl('/users/me'), {
      timeout: 10_000,
      headers: { Authorization: `Bearer ${decryptConfiguredSecret(event.vendor.mp_access_token)}` },
    });
    const accountId = String(accountResponse.data?.id ?? '');
    if (!accountId) throw new Error('Could not verify the Mercado Pago account identity');
    await db.vendor.update({ where: { id: event.vendor_id }, data: { mp_user_id: accountId } });
    event = await db.webhookEvent.findUnique({ where: { id: eventId }, include: { vendor: { include: { client: true } } } });
    if (!event) return;
  }
  if (!event.vendor.mp_user_id) throw new Error('Mercado Pago account identity is unavailable');
  const paymentResource = await axios.get(mercadoPagoApiUrl(`/v1/payments/${encodeURIComponent(event.resource_id)}`), {
    timeout: 12_000,
    headers: { Authorization: `Bearer ${decryptConfiguredSecret(event.vendor.mp_access_token)}` },
  });
  const mp = paymentResource.data as Record<string, any>;
  const externalReference = String(mp.external_reference ?? '');
  let order = await db.order.findFirst({ where: { id: externalReference, client_id: event.client_id, vendor_id: event.vendor_id } });
  // V1 historically used external_id as external_reference; scope lookup to its owner and account.
  if (!order) order = await db.order.findFirst({ where: { external_id: externalReference, client_id: event.client_id, vendor_id: event.vendor_id } });
  if (!order) throw new Error('Payment reference does not belong to this tenant and account');
  const collectorId = String(mp.collector_id ?? '');
  if (!collectorId) throw new Error('Mercado Pago response omitted collector_id');
  assertPaymentMatchesOrder({ vendorId: event.vendor_id, amount: order.monto.toString(), currency: order.moneda, externalReference }, {
    collectorId,
    transactionAmount: String(mp.transaction_amount ?? ''),
    currencyId: String(mp.currency_id ?? ''),
    externalReference,
  }, event.vendor.mp_user_id);
  const providerStatus = String(mp.status ?? '');
  const status = normalizePaymentStatus(providerStatus);
  if (!status) throw new Error(`Unsupported Mercado Pago payment status: ${providerStatus || 'missing'}`);
  const providerId = String(mp.id ?? event.resource_id);
  await db.$transaction(async (tx) => {
    let payment = await tx.payment.findUnique({ where: { provider_payment_id: providerId }, include: { order: true } });
    const previousStatus = payment?.estado;
    if (payment && (payment.client_id !== event.client_id || payment.vendor_id !== event.vendor_id || payment.order_id !== order!.id)) {
      throw new Error('Mercado Pago payment is already assigned to a different tenant operation');
    }
    if (!payment) {
      payment = await tx.payment.create({ data: {
        client_id: event.client_id, vendor_id: event.vendor_id, order_id: order!.id,
        idempotency_key: `webhook:${providerId}`.slice(0, 128), request_fingerprint: `webhook:${providerId}`,
        provider_idempotency_key: `webhook:${providerId}`, provider_payment_id: providerId,
        estado: status, status_detail: String(mp.status_detail ?? '') || null,
        monto: new Prisma.Decimal(String(mp.transaction_amount)), moneda: String(mp.currency_id),
      }, include: { order: true } });
    } else if (payment.estado !== status) {
      payment = await tx.payment.update({ where: { id: payment.id }, data: { estado: status, status_detail: String(mp.status_detail ?? '') || null }, include: { order: true } });
    }
    const currentOrder = await tx.order.findUniqueOrThrow({ where: { id: order!.id } });
    const isCurrentAttempt = !currentOrder.last_payment_id || currentOrder.last_payment_id === payment.id;
    const nextOrderStatus = currentOrder.estado === 'APPROVED' && status === 'PENDING' ? 'APPROVED' : status;
    if (isCurrentAttempt) await tx.order.update({ where: { id: currentOrder.id }, data: { last_payment_id: payment.id, mp_payment_id: providerId, estado: nextOrderStatus } });
    // Event-key upsert deduplicates notification even when MP retries the same event.
    if (!previousStatus || previousStatus !== status) {
      await enqueuePaymentCallback(tx, { ...order!, estado: nextOrderStatus }, { ...payment, estado: status }, event.vendor.client, previousStatus ?? 'CREATED');
    }
    await tx.webhookEvent.update({ where: { id: event.id }, data: { estado: 'COMPLETED', processed_at: new Date(), locked_until: null, last_error: null, payment_id: payment.id } });
  });
};

const acceptWebhook = async (req: Request, res: Response, isV2: boolean): Promise<void> => {
  const queryAccount = isV2 ? req.query.account_id : req.query.vendedor_id;
  const accountId = Number(queryAccount);
  const body = req.body ?? {};
  const rawId = req.query['data.id'] ?? body.data?.id ?? body.id;
  const dataId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId).toLowerCase() : '';
  const requestId = req.header('x-request-id');
  const xSignature = req.header('x-signature');
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !dataId || !requestId) { res.status(400).send('Invalid webhook request'); return; }
  if (body.data?.id && String(body.data.id).toLowerCase() !== dataId) { res.status(400).send('Webhook payment ID mismatch'); return; }
  if (body.type !== 'payment' && !String(body.action ?? '').startsWith('payment.')) { res.sendStatus(200); return; }
  if (!validateMpWebhookSignature(xSignature, requestId, dataId, process.env.MP_WEBHOOK_SECRET)) { res.sendStatus(403); return; }
  const vendor = await prisma.vendor.findUnique({ where: { id: accountId }, include: { client: true } });
  if (!vendor) { res.sendStatus(404); return; }
  try {
    const event = await prisma.webhookEvent.upsert({
      where: { request_id: requestId },
      create: { request_id: requestId, client_id: vendor.client_id, vendor_id: vendor.id, resource_id: dataId, event_type: String(body.action ?? body.type), payload: { type: body.type, action: body.action, live_mode: body.live_mode } },
      update: {},
    });
    if (event.client_id !== vendor.client_id || event.vendor_id !== vendor.id || event.resource_id !== dataId) { res.sendStatus(409); return; }
    if (event.estado === 'COMPLETED') { res.sendStatus(200); return; }
    const claimed = await prisma.webhookEvent.updateMany({ where: { id: event.id, OR: [{ estado: { in: ['RECEIVED', 'FAILED'] }, next_attempt_at: { lte: new Date() } }, { estado: 'PROCESSING', locked_until: { lt: new Date() } }] }, data: { estado: 'PROCESSING', attempts: { increment: 1 }, locked_until: new Date(Date.now() + 60_000) } });
    if (!claimed.count) { res.sendStatus(200); return; }
    try {
      await processStoredPaymentEvent(event.id);
      res.sendStatus(200);
    } catch (error) {
      const current = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { estado: 'FAILED', next_attempt_at: retryDelay(current.attempts), locked_until: null, last_error: error instanceof Error ? error.message.slice(0, 500) : 'Payment reconciliation failed' } });
      res.sendStatus(503);
    }
  } catch (error) {
    console.error('Webhook persistence failed:', error instanceof Error ? error.message : 'unknown');
    res.sendStatus(503);
  }
};

export const handleWebhookV2 = (req: Request, res: Response) => acceptWebhook(req, res, true);
export const handleWebhookV1 = (req: Request, res: Response) => acceptWebhook(req, res, false);

export const startWebhookRetryWorker = (db: PrismaClient = prisma): NodeJS.Timeout => {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const rows = await db.webhookEvent.findMany({ where: { OR: [
        { estado: 'FAILED', next_attempt_at: { lte: now } },
        { estado: 'PROCESSING', locked_until: { lt: now } },
      ] }, orderBy: { next_attempt_at: 'asc' }, take: 20, select: { id: true } });
      for (const row of rows) {
        const claimed = await db.webhookEvent.updateMany({ where: { id: row.id, OR: [
          { estado: 'FAILED', next_attempt_at: { lte: new Date() } },
          { estado: 'PROCESSING', locked_until: { lt: new Date() } },
        ] }, data: { estado: 'PROCESSING', attempts: { increment: 1 }, locked_until: new Date(Date.now() + 60_000) } });
        if (!claimed.count) continue;
        try { await processStoredPaymentEvent(row.id, db); }
        catch (error) {
          const current = await db.webhookEvent.findUniqueOrThrow({ where: { id: row.id } });
          await db.webhookEvent.update({ where: { id: row.id }, data: { estado: 'FAILED', next_attempt_at: retryDelay(current.attempts), locked_until: null, last_error: error instanceof Error ? error.message.slice(0, 500) : 'Payment reconciliation failed' } });
        }
      }
    } catch (error) { console.error('Webhook retry worker failed:', error instanceof Error ? error.message : 'unknown'); }
    finally { running = false; }
  }, 5_000);
};
