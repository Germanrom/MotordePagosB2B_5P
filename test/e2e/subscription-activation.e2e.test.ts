import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { testDatabaseReady } from '../helpers/test-environment';
import { close, listen } from '../helpers/http-server';

const e2eTest = testDatabaseReady ? test : test.skip;

e2eTest('subscription activates only after a verified first payment and sends deduplicated signed callbacks', async () => {
  const { default: db } = await import('../../src/config/prisma');
  const { encryptSecret } = await import('../../src/services/security/secret-crypto');
  const { hashCallbackSignature } = await import('../../src/services/security/credentials');
  const { deliverOneSaasCallback } = await import('../../src/services/subscriptions/subscription-callback.service');
  const suffix = randomUUID();
  const preapprovalId = `preapproval-${suffix}`;
  const invoiceId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const paymentId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let activePaymentId = paymentId;
  let paymentStatus = 'rejected';
  let paymentCollector = 123;
  const webhookSecret = `saas-webhook-${suffix}`;
  const callbackSecret = `app-webhook-${suffix}`;
  const old = Object.fromEntries(['MP_API_BASE_URL', 'MP_SAAS_ACCESS_TOKEN_ENCRYPTED', 'MP_SAAS_COLLECTOR_ID', 'MP_SAAS_WEBHOOK_SECRET'].map((key) => [key, process.env[key]]));
  const callbacks: Array<{ headers: import('node:http').IncomingHttpHeaders; payload: Record<string, any> }> = [];
  let rejectFirstCallback = true;
  let localId = '';

  const provider = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://provider.test');
    const send = (body: unknown) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (request.headers.authorization !== 'Bearer TEST-fivepeaks') { response.writeHead(401).end(); return; }
    if (url.pathname === `/preapproval/${preapprovalId}`) {
      send({ id: preapprovalId, status: 'authorized', collector_id: 123, external_reference: localId,
        init_point: 'https://www.mercadopago.com.ar/checkout', next_payment_date: '2026-05-05T00:00:00-03:00',
        auto_recurring: { transaction_amount: '100.00', currency_id: 'ARS' } });
      return;
    }
    if (url.pathname === '/authorized_payments/search') {
      send({ results: url.searchParams.get('payment_id') === activePaymentId
        ? [{ id: Number(invoiceId), payment: { id: Number(activePaymentId) } }] : [] });
      return;
    }
    if (url.pathname === `/authorized_payments/${invoiceId}`) {
      send({ id: Number(invoiceId), preapproval_id: preapprovalId, external_reference: localId,
        transaction_amount: '100.00', currency_id: 'ARS', debit_date: '2026-04-04T00:00:00-03:00',
        payment: { id: Number(activePaymentId), status: paymentStatus } });
      return;
    }
    if (url.pathname === `/v1/payments/${activePaymentId}`) {
      send({ id: Number(activePaymentId), collector_id: paymentCollector, external_reference: localId,
        transaction_amount: '100.00', currency_id: 'ARS', status: paymentStatus,
        status_detail: paymentStatus === 'approved' ? 'accredited' : 'cc_rejected_other_reason',
        date_approved: paymentStatus === 'approved' ? '2026-04-04T12:00:00-03:00' : null });
      return;
    }
    response.writeHead(404).end();
  });
  const callbackServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    callbacks.push({ headers: request.headers, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    if (rejectFirstCallback) { rejectFirstCallback = false; response.writeHead(503).end(); return; }
    response.writeHead(204).end();
  });
  const providerBase = await listen(provider);
  const callbackBase = await listen(callbackServer);
  process.env.MP_API_BASE_URL = providerBase;
  process.env.MP_SAAS_ACCESS_TOKEN_ENCRYPTED = encryptSecret('TEST-fivepeaks', process.env.TOKEN_ENCRYPTION_KEY!);
  process.env.MP_SAAS_COLLECTOR_ID = '123';
  process.env.MP_SAAS_WEBHOOK_SECRET = webhookSecret;
  const { app } = await import('../../src/app');
  const engine = createServer(app);
  const engineBase = await listen(engine);
  let clientId = '';

  const notify = (topic: string, id: string, requestId: string, valid = true) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const manifest = `id:${id.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
    const signature = createHmac('sha256', webhookSecret).update(manifest).digest('hex');
    return fetch(`${engineBase}/v2/subscriptions/webhook/mercadopago?data.id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId,
        'x-signature': `ts=${timestamp},v1=${valid ? signature : '0'.repeat(64)}` },
      body: JSON.stringify({ type: topic, action: `${topic}.updated`, data: { id } }),
    });
  };

  try {
    const client = await db.client.create({ data: {
      client_id: `saas-e2e-${suffix}`, callback_url: `${callbackBase}/orders`,
      subscription_callback_url: `${callbackBase}/subscriptions`, redirect_uri: `${callbackBase}/return`,
      webhook_secret: encryptSecret(callbackSecret, process.env.TOKEN_ENCRYPTION_KEY!),
    } });
    clientId = client.id;
    const subscription = await db.saasSubscription.create({ data: {
      client_id: client.id, external_tenant_id: `company-${suffix}`, idempotency_key: `key-${suffix}`,
      request_fingerprint: 'test-fingerprint', plan_code: 'pro', plan_version: 'v1',
      terms_snapshot: { description: 'Pro' }, amount: '100.00', currency: 'ARS', payer_email: 'payer@example.com',
      provider_preapproval_id: preapprovalId, status: 'PENDING_CHECKOUT',
    } });
    localId = subscription.id;

    assert.equal((await notify('subscription_preapproval', preapprovalId, `bad-${suffix}`, false)).status, 403);
    assert.equal(await db.saasWebhookEvent.count({ where: { subscription_id: subscription.id } }), 0);
    assert.equal((await notify('subscription_preapproval', preapprovalId, `auth-${suffix}`)).status, 200);
    assert.equal((await db.saasSubscription.findUniqueOrThrow({ where: { id: subscription.id } })).status, 'AUTHORIZED');
    assert.equal(await db.saasCallbackDelivery.count({ where: { subscription_id: subscription.id } }), 1);

    assert.equal((await notify('subscription_authorized_payment', invoiceId, `invoice-${suffix}`)).status, 200);
    assert.equal((await db.saasSubscription.findUniqueOrThrow({ where: { id: subscription.id } })).status, 'AUTHORIZED');
    assert.equal(await db.saasCallbackDelivery.count({ where: { subscription_id: subscription.id } }), 2);

    activePaymentId = `${Number(paymentId) + 1}`;
    paymentStatus = 'approved';
    paymentCollector = 999;
    assert.equal((await notify('subscription_authorized_payment', invoiceId, `wrong-account-${suffix}`)).status, 503);
    assert.equal((await db.saasSubscription.findUniqueOrThrow({ where: { id: subscription.id } })).status, 'AUTHORIZED');
    paymentCollector = 123;
    assert.equal((await notify('subscription_authorized_payment', invoiceId, `recovered-${suffix}`)).status, 200);
    const activated = await db.saasSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    assert.equal(activated.status, 'ACTIVE');
    assert.equal(activated.first_paid_at?.toISOString(), '2026-04-04T15:00:00.000Z');
    assert.equal(activated.paid_through?.toISOString(), '2026-05-05T03:00:00.000Z');
    assert.equal(await db.saasBillingPeriod.count({ where: { subscription_id: subscription.id } }), 1);
    assert.equal(await db.saasPaymentAttempt.count({ where: { period: { subscription_id: subscription.id } } }), 2);
    assert.equal(await db.saasCallbackDelivery.count({ where: { subscription_id: subscription.id } }), 3);

    assert.equal((await notify('subscription_authorized_payment', invoiceId, `invoice-${suffix}`)).status, 200);
    assert.equal((await notify('subscription_authorized_payment', invoiceId, `invoice-repeat-${suffix}`)).status, 200);
    assert.equal((await notify('payment', activePaymentId, `payment-${suffix}`)).status, 200);
    assert.equal(await db.saasBillingPeriod.count({ where: { subscription_id: subscription.id } }), 1);
    assert.equal(await db.saasCallbackDelivery.count({ where: { subscription_id: subscription.id } }), 3);

    assert.equal(await deliverOneSaasCallback(db), true);
    assert.equal(await deliverOneSaasCallback(db), true);
    assert.equal(await deliverOneSaasCallback(db), true);
    assert.equal(await deliverOneSaasCallback(db), false);
    const pendingRetry = await db.saasCallbackDelivery.findFirstOrThrow({ where: { subscription_id: subscription.id, status: 'PENDING' } });
    await db.saasCallbackDelivery.update({ where: { id: pendingRetry.id }, data: { next_attempt_at: new Date(0) } });
    assert.equal(await deliverOneSaasCallback(db), true);
    assert.equal(await deliverOneSaasCallback(db), false);
    assert.equal(await db.saasCallbackDelivery.count({ where: { subscription_id: subscription.id, status: 'DELIVERED' } }), 3);
    assert.deepEqual(callbacks.map((callback) => callback.payload.type).sort(), ['subscription.authorized', 'subscription.authorized', 'subscription.payment_approved', 'subscription.payment_rejected']);
    assert.equal(callbacks[0].payload.event_id, callbacks[3].payload.event_id);
    for (const callback of callbacks) {
      assert.equal(callback.headers['x-motor-event-id'], callback.payload.event_id);
      assert.equal(callback.headers['x-motor-signature'], hashCallbackSignature(callback.payload, callbackSecret));
    }
  } finally {
    if (clientId) {
      await db.saasCallbackDelivery.deleteMany({ where: { client_id: clientId } });
      await db.saasWebhookEvent.deleteMany({ where: { OR: [{ client_id: clientId }, { request_id: { endsWith: suffix } }] } });
      const periodIds = (await db.saasBillingPeriod.findMany({ where: { subscription: { client_id: clientId } }, select: { id: true } })).map((period) => period.id);
      await db.saasPaymentAttempt.deleteMany({ where: { period_id: { in: periodIds } } });
      await db.saasBillingPeriod.deleteMany({ where: { subscription: { client_id: clientId } } });
      await db.saasSubscription.deleteMany({ where: { client_id: clientId } });
      await db.client.delete({ where: { id: clientId } });
    }
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await Promise.all([close(engine), close(callbackServer), close(provider)]);
  }
});
