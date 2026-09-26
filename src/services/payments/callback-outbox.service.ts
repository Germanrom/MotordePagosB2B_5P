import axios from 'axios';
import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../config/prisma';
import { decryptConfiguredSecret } from '../security/secret-crypto';
import { hashCallbackSignature } from '../security/credentials';

type Tx = Prisma.TransactionClient;
type CallbackState = { id: string; external_id: string; estado: string; mp_payment_id: string | null; monto: Prisma.Decimal; moneda: string };
type CallbackPayment = { id: string; provider_payment_id: string | null; estado: string };
type CallbackTenant = { id: string; client_id: string; callback_url: string; webhook_secret: string };

export const enqueuePaymentCallback = async (
  tx: Tx,
  order: CallbackState,
  payment: CallbackPayment,
  tenant: CallbackTenant,
  transitionFrom = 'CREATED',
): Promise<void> => {
  const paymentId = payment.provider_payment_id ?? payment.id;
  const eventKey = `${paymentId}:${transitionFrom}>${payment.estado}`;
  const payload = {
    event_id: eventKey,
    id_orden: order.id,
    external_id: order.external_id,
    estado: payment.estado.toLowerCase(),
    mp_payment_id: payment.provider_payment_id,
    monto: order.monto.toFixed(2),
    moneda: order.moneda,
  };
  const signature = hashCallbackSignature(payload, decryptConfiguredSecret(tenant.webhook_secret));

  await tx.callbackDelivery.upsert({
    where: { event_key: eventKey },
    create: {
      event_key: eventKey,
      client_id: tenant.id,
      payment_id: payment.id,
      callback_url: tenant.callback_url,
      payload,
      signature,
    },
    update: {},
  });
};

export const deliverOnePendingCallback = async (db: PrismaClient = prisma): Promise<boolean> => {
  const row = await db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<Array<{
      id: string;
      callback_url: string;
      payload: Prisma.JsonValue;
      signature: string;
      event_key: string;
      attempts: number;
    }>>`
      UPDATE "CallbackDelivery"
      SET "estado" = 'PROCESSING', "attempts" = "attempts" + 1,
          "locked_until" = NOW() + INTERVAL '60 seconds'
      WHERE "id" = (
        SELECT "id" FROM "CallbackDelivery"
        WHERE ("estado" = 'PENDING' AND "next_attempt_at" <= NOW())
           OR ("estado" = 'PROCESSING' AND "locked_until" < NOW())
        ORDER BY "createdAt"
        LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "callback_url", "payload", "signature", "event_key", "attempts"
    `;
    return claimed[0];
  });

  if (!row) return false;
  try {
    await axios.post(row.callback_url, row.payload, {
      timeout: 8_000,
      headers: {
        'x-motor-signature': row.signature,
        'x-motor-event-id': row.event_key,
        'Idempotency-Key': row.event_key,
        'Content-Type': 'application/json',
      },
    });
    await db.callbackDelivery.update({
      where: { id: row.id },
      data: { estado: 'DELIVERED', delivered_at: new Date(), locked_until: null, last_error: null },
    });
  } catch (error) {
    const delaySeconds = Math.min(3_600, 2 ** Math.min(row.attempts, 10));
    await db.callbackDelivery.update({
      where: { id: row.id },
      data: {
        estado: 'PENDING',
        locked_until: null,
        next_attempt_at: new Date(Date.now() + delaySeconds * 1_000),
        last_error: error instanceof Error ? error.message.slice(0, 500) : 'Callback delivery failed',
      },
    });
  }
  return true;
};

export const startCallbackOutboxWorker = (db: PrismaClient = prisma): NodeJS.Timeout => {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      while (await deliverOnePendingCallback(db)) { /* Drain due items; delivery is persisted before sending. */ }
    } catch (error) {
      console.error('Callback outbox worker failed:', error instanceof Error ? error.message : 'unknown error');
    } finally {
      running = false;
    }
  }, 2_000);
};
