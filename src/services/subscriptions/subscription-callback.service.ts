import axios from 'axios';
import { Prisma, PrismaClient, type Client, type SaasSubscription } from '@prisma/client';
import prisma from '../../config/prisma';
import { hashCallbackSignature } from '../security/credentials';
import { decryptConfiguredSecret } from '../security/secret-crypto';

type CallbackClient = Pick<Client, 'id' | 'subscription_callback_url' | 'webhook_secret'>;
type CallbackSubscription = Pick<SaasSubscription, 'id' | 'client_id' | 'external_tenant_id' | 'plan_code' | 'plan_version' | 'amount' | 'currency'>;

export const enqueueSubscriptionCallback = async (
  tx: Prisma.TransactionClient,
  client: CallbackClient,
  subscription: CallbackSubscription,
  eventKey: string,
  eventType: string,
  details: Record<string, unknown> = {},
): Promise<void> => {
  if (!client.subscription_callback_url) throw new Error('Subscription callback URL is missing');
  const payload = {
    event_id: eventKey,
    type: eventType,
    subscription_id: subscription.id,
    external_tenant_id: subscription.external_tenant_id,
    plan_code: subscription.plan_code,
    plan_version: subscription.plan_version,
    amount: subscription.amount.toFixed(2),
    currency: subscription.currency,
    ...details,
  };
  await tx.saasCallbackDelivery.upsert({
    where: { event_key: eventKey },
    create: {
      event_key: eventKey,
      client_id: client.id,
      subscription_id: subscription.id,
      callback_url: client.subscription_callback_url,
      payload: payload as Prisma.InputJsonValue,
      signature: hashCallbackSignature(payload, decryptConfiguredSecret(client.webhook_secret)),
    },
    update: {},
  });
};

export const deliverOneSaasCallback = async (db: PrismaClient = prisma): Promise<boolean> => {
  const row = await db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<Array<{
      id: string; callback_url: string; payload: Prisma.JsonValue; signature: string; event_key: string; attempts: number;
    }>>`
      UPDATE "SaasCallbackDelivery"
      SET "status" = 'PROCESSING', "attempts" = "attempts" + 1,
          "locked_until" = NOW() + INTERVAL '60 seconds'
      WHERE "id" = (
        SELECT "id" FROM "SaasCallbackDelivery"
        WHERE ("status" = 'PENDING' AND "next_attempt_at" <= NOW())
           OR ("status" = 'PROCESSING' AND "locked_until" < NOW())
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
    await db.saasCallbackDelivery.update({ where: { id: row.id }, data: { status: 'DELIVERED', delivered_at: new Date(), locked_until: null, last_error: null } });
  } catch (error) {
    await db.saasCallbackDelivery.update({ where: { id: row.id }, data: {
      status: 'PENDING', locked_until: null,
      next_attempt_at: new Date(Date.now() + Math.min(3_600, 2 ** Math.min(row.attempts, 10)) * 1_000),
      last_error: error instanceof Error ? error.message.slice(0, 500) : 'Subscription callback delivery failed',
    } });
  }
  return true;
};

export const startSaasCallbackWorker = (db: PrismaClient = prisma): NodeJS.Timeout => {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      while (await deliverOneSaasCallback(db)) { /* Persisted retries are claimed with SKIP LOCKED. */ }
    } catch (error) {
      console.error('Subscription callback worker failed:', error instanceof Error ? error.message : 'unknown');
    } finally { running = false; }
  }, 2_000);
};
