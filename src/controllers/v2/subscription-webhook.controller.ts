import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import prisma from '../../config/prisma';
import { validateMpWebhookSignature } from '../../services/mercadopago/webhook-signature';
import { reconcileSaasNotification } from '../../services/subscriptions/subscription-reconciliation.service';

const knownTopics = new Set(['subscription_preapproval', 'subscription_authorized_payment', 'payment']);
const retryDelay = (attempt: number) => new Date(Date.now() + Math.min(3_600, 2 ** Math.min(attempt, 10)) * 1_000);

export const processStoredSaasEvent = async (eventId: string, db: PrismaClient = prisma): Promise<void> => {
  const event = await db.saasWebhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status === 'COMPLETED') return;
  const subscriptionId = await reconcileSaasNotification(event.topic, event.resource_id, db);
  const subscription = await db.saasSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  await db.saasWebhookEvent.update({ where: { id: eventId }, data: {
    client_id: subscription.client_id, subscription_id: subscription.id, status: 'COMPLETED',
    processed_at: new Date(), locked_until: null, last_error: null,
  } });
};

const markFailed = async (eventId: string, db: PrismaClient, error: unknown): Promise<void> => {
  const event = await db.saasWebhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  await db.saasWebhookEvent.update({ where: { id: eventId }, data: {
    status: 'FAILED', next_attempt_at: retryDelay(event.attempts), locked_until: null,
    last_error: error instanceof Error ? error.message.slice(0, 500) : 'Subscription reconciliation failed',
  } });
};

export const acceptSaasWebhook = async (req: Request, res: Response): Promise<void> => {
  const body = req.body ?? {};
  const topic = typeof body.type === 'string' ? body.type : '';
  const rawQueryId = req.query['data.id'];
  const rawBodyId = body.data?.id ?? body.id;
  const queryId = typeof rawQueryId === 'string' ? rawQueryId : '';
  const bodyId = typeof rawBodyId === 'string' || typeof rawBodyId === 'number' ? String(rawBodyId) : '';
  const resourceId = queryId || bodyId;
  const requestId = req.header('x-request-id') ?? '';
  if (!resourceId || !requestId || (queryId && bodyId && queryId.toLowerCase() !== bodyId.toLowerCase())) {
    res.sendStatus(400); return;
  }
  if (!validateMpWebhookSignature(req.header('x-signature'), requestId, resourceId.toLowerCase(), process.env.MP_SAAS_WEBHOOK_SECRET)) {
    res.sendStatus(403); return;
  }
  if (!knownTopics.has(topic)) { res.sendStatus(200); return; }

  try {
    const event = await prisma.saasWebhookEvent.upsert({
      where: { request_id: requestId },
      create: { request_id: requestId, topic, resource_id: resourceId, payload: {
        type: topic, action: typeof body.action === 'string' ? body.action : null,
        live_mode: typeof body.live_mode === 'boolean' ? body.live_mode : null,
      } },
      update: {},
    });
    if (event.topic !== topic || event.resource_id.toLowerCase() !== resourceId.toLowerCase()) { res.sendStatus(409); return; }
    if (event.status === 'COMPLETED') { res.sendStatus(200); return; }
    const claimed = await prisma.saasWebhookEvent.updateMany({ where: { id: event.id, OR: [
      { status: { in: ['RECEIVED', 'FAILED'] }, next_attempt_at: { lte: new Date() } },
      { status: 'PROCESSING', locked_until: { lt: new Date() } },
    ] }, data: { status: 'PROCESSING', attempts: { increment: 1 }, locked_until: new Date(Date.now() + 60_000) } });
    if (!claimed.count) { res.sendStatus(200); return; }
    try {
      await processStoredSaasEvent(event.id);
      res.sendStatus(200);
    } catch (error) {
      await markFailed(event.id, prisma, error);
      res.sendStatus(503);
    }
  } catch (error) {
    console.error('Subscription webhook persistence failed:', error instanceof Error ? error.message : 'unknown');
    res.sendStatus(503);
  }
};

export const startSaasWebhookRetryWorker = (db: PrismaClient = prisma): NodeJS.Timeout => {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const events = await db.saasWebhookEvent.findMany({ where: { OR: [
        { status: 'FAILED', next_attempt_at: { lte: now } },
        { status: 'PROCESSING', locked_until: { lt: now } },
      ] }, orderBy: { next_attempt_at: 'asc' }, take: 20, select: { id: true } });
      for (const event of events) {
        const claimed = await db.saasWebhookEvent.updateMany({ where: { id: event.id, OR: [
          { status: 'FAILED', next_attempt_at: { lte: new Date() } },
          { status: 'PROCESSING', locked_until: { lt: new Date() } },
        ] }, data: { status: 'PROCESSING', attempts: { increment: 1 }, locked_until: new Date(Date.now() + 60_000) } });
        if (!claimed.count) continue;
        try { await processStoredSaasEvent(event.id, db); }
        catch (error) { await markFailed(event.id, db, error); }
      }
    } catch (error) {
      console.error('Subscription webhook retry worker failed:', error instanceof Error ? error.message : 'unknown');
    } finally { running = false; }
  }, 5_000);
};
