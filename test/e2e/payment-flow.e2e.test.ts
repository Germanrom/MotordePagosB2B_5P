import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { testDatabaseReady } from '../helpers/test-environment';
import { close, listen } from '../helpers/http-server';

const e2eTest = testDatabaseReady ? test : test.skip;
const readJson = async (request: import('node:http').IncomingMessage): Promise<Record<string, any>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};
e2eTest('tenant links Mercado Pago, creates a Brick payment, reconciles its webhook, and deduplicates delivery', async () => {
  const { default: db } = await import('../../src/config/prisma');
  const { encryptSecret, decryptSecret } = await import('../../src/services/security/secret-crypto');
  const { hashApiKey, hashCallbackSignature } = await import('../../src/services/security/credentials');
  const suffix = randomUUID();
  const providerPaymentId = `mp-${suffix}`;
  let paymentData: Record<string, any> | null = null;
  const callbackRequests: Array<{ path: string; headers: import('node:http').IncomingHttpHeaders; body: Record<string, any> }> = [];

  const provider = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://provider.test');
    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_in: 3600,
        user_id: `mp-user-${suffix}`, public_key: `APP_USR-public-${suffix}`,
      }));
      return;
    }
    if (url.pathname === '/users/me' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `mp-user-${suffix}` }));
      return;
    }
    if (url.pathname === '/v1/payments' && request.method === 'POST') {
      paymentData = await readJson(request);
      response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({
        id: providerPaymentId, status: 'in_process', status_detail: 'pending_review', collector_id: `mp-user-${suffix}`,
        transaction_amount: paymentData.transaction_amount, currency_id: paymentData.currency_id ?? 'ARS',
        external_reference: paymentData.external_reference,
      }));
      return;
    }
    if (url.pathname === `/v1/payments/${providerPaymentId}` && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        id: providerPaymentId, status: 'approved', status_detail: 'accredited', collector_id: `mp-user-${suffix}`,
        transaction_amount: paymentData?.transaction_amount, currency_id: paymentData?.currency_id ?? 'ARS',
        external_reference: paymentData?.external_reference,
      }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not_found', path: url.pathname }));
  });
  const callbacks = createServer(async (request, response) => {
    callbackRequests.push({ path: request.url ?? '/', headers: request.headers, body: await readJson(request) });
    response.writeHead(204).end();
  });
  const providerBase = await listen(provider);
  const callbackBase = await listen(callbacks);
  process.env.MP_API_BASE_URL = providerBase;
  process.env.MP_CLIENT_ID = `app-${suffix}`;
  process.env.MP_CLIENT_SECRET = `app-secret-${suffix}`;
  const { app } = await import('../../src/app');
  const engine = createServer(app);
  const engineBase = await listen(engine);
  process.env.APP_BASE_URL = engineBase;

  const apiKey = `api-${suffix}`;
  const webhookSecret = `tenant-secret-${suffix}`;
  const client = await db.client.create({ data: {
    client_id: `e2e-${suffix}`, api_key_hash: hashApiKey(apiKey),
    callback_url: `${callbackBase}/oauth-result`, redirect_uri: `${callbackBase}/connected`,
    webhook_secret: encryptSecret(webhookSecret, process.env.TOKEN_ENCRYPTION_KEY!),
  } });
  const headers = { 'x-api-key': apiKey, 'content-type': 'application/json' };

  try {
    const startResponse = await fetch(`${engineBase}/v2/auth/mp-url`, { headers });
    assert.equal(startResponse.status, 200);
    const { auth_url: authUrl } = await startResponse.json() as { auth_url: string };
    const state = new URL(authUrl).searchParams.get('state');
    assert.ok(state);

    const oauthResponse = await fetch(`${engineBase}/v2/auth/callback?code=approved-code&state=${encodeURIComponent(state!)}`, { redirect: 'manual' });
    assert.equal(oauthResponse.status, 302);
    assert.equal(oauthResponse.headers.get('location'), `${callbackBase}/connected`);
    assert.equal(callbackRequests[0]?.path, '/oauth-result');
    const oauthPayload = callbackRequests[0].body;
    assert.equal(callbackRequests[0].headers['x-motor-signature'], hashCallbackSignature(oauthPayload, webhookSecret));

    const accountResponse = await fetch(`${engineBase}/v2/auth/account`, { headers });
    assert.deepEqual(await accountResponse.json(), {
      connected: true, public_key: `APP_USR-public-${suffix}`,
      expires_at: (await db.vendor.findFirstOrThrow({ where: { client_id: client.id } })).mp_expires_at?.toISOString(),
    });
    const vendor = await db.vendor.findFirstOrThrow({ where: { client_id: client.id, v2_active: true } });
    assert.equal(decryptSecret(vendor.mp_access_token, process.env.TOKEN_ENCRYPTION_KEY!), 'test-access-token');

    const paymentResponse = await fetch(`${engineBase}/v2/pagos/brick`, {
      method: 'POST', headers: { ...headers, 'idempotency-key': `idem-${suffix}` },
      body: JSON.stringify({ external_id: `invoice-${suffix}`, concepto: 'Test order', transaction_amount: 420.5,
        currency_id: 'ARS', token: 'brick-card-token', installments: 1, payment_method_id: 'visa',
        payer: { email: 'buyer@example.test' } }),
    });
    assert.equal(paymentResponse.status, 200);
    const paymentBody = await paymentResponse.json() as { id_pago: string; id_orden: string; estado: string; mp_payment_id: string };
    assert.equal(paymentBody.estado, 'pending');
    assert.equal(paymentBody.mp_payment_id, providerPaymentId);

    const timestamp = String(Math.floor(Date.now() / 1000));
    const requestId = `request-${suffix}`;
    const manifest = `id:${providerPaymentId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
    const signature = createHmac('sha256', process.env.MP_WEBHOOK_SECRET!).update(manifest).digest('hex');
    const webhookUrl = `${engineBase}/v2/webhook/mercadopago?account_id=${vendor.id}&data.id=${providerPaymentId}`;
    const webhookHeaders = { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${signature}` };
    const invalidWebhook = await fetch(webhookUrl, { method: 'POST', headers: { ...webhookHeaders, 'x-signature': `ts=${timestamp},v1=${'0'.repeat(64)}` }, body: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: providerPaymentId } }) });
    assert.equal(invalidWebhook.status, 403);
    assert.equal(await db.webhookEvent.count({ where: { client_id: client.id } }), 0);
    const webhookResponse = await fetch(webhookUrl, { method: 'POST', headers: webhookHeaders, body: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: providerPaymentId } }) });
    assert.equal(webhookResponse.status, 200);

    const orderResponse = await fetch(`${engineBase}/v2/ordenes/${paymentBody.id_orden}/estado`, { headers });
    assert.equal(orderResponse.status, 200);
    const orderStatus = await orderResponse.json() as { estado: string; mp_payment_id: string };
    assert.equal(orderStatus.estado, 'APPROVED');
    assert.equal(orderStatus.mp_payment_id, providerPaymentId);
    assert.equal(await db.webhookEvent.count({ where: { client_id: client.id, estado: 'COMPLETED' } }), 1);
    assert.equal(await db.callbackDelivery.count({ where: { client_id: client.id, event_key: `${providerPaymentId}:PENDING>APPROVED` } }), 1);

    const { deliverOnePendingCallback } = await import('../../src/services/payments/callback-outbox.service');
    assert.equal(await deliverOnePendingCallback(db), true);
    assert.equal(await deliverOnePendingCallback(db), true);
    assert.equal(await deliverOnePendingCallback(db), false);
    const paymentCallbacks = callbackRequests.filter((callback) => callback.path === '/oauth-result').slice(1);
    assert.deepEqual(paymentCallbacks.map((callback) => callback.body.estado).sort(), ['approved', 'pending']);
    for (const callback of paymentCallbacks) {
      assert.equal(callback.headers['x-motor-event-id'], callback.body.event_id);
      assert.equal(callback.headers['idempotency-key'], callback.body.event_id);
      assert.equal(callback.headers['x-motor-signature'], hashCallbackSignature(callback.body, webhookSecret));
    }
    assert.equal(await db.callbackDelivery.count({ where: { client_id: client.id, estado: 'DELIVERED' } }), 2);

    const duplicateWebhook = await fetch(webhookUrl, { method: 'POST', headers: webhookHeaders, body: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: providerPaymentId } }) });
    assert.equal(duplicateWebhook.status, 200);
    assert.equal(await db.webhookEvent.count({ where: { client_id: client.id } }), 1);
    assert.equal(await db.callbackDelivery.count({ where: { client_id: client.id, event_key: `${providerPaymentId}:PENDING>APPROVED` } }), 1);

    const replayedOAuth = await fetch(`${engineBase}/v2/auth/callback?code=approved-code&state=${encodeURIComponent(state!)}`, { redirect: 'manual' });
    assert.equal(replayedOAuth.status, 400);
  } finally {
    await db.callbackDelivery.deleteMany({ where: { client_id: client.id } });
    await db.webhookEvent.deleteMany({ where: { client_id: client.id } });
    await db.payment.deleteMany({ where: { client_id: client.id } });
    await db.order.deleteMany({ where: { client_id: client.id } });
    await db.oAuthState.deleteMany({ where: { client_id: client.id } });
    await db.vendor.deleteMany({ where: { client_id: client.id } });
    await db.client.delete({ where: { id: client.id } });
    await Promise.all([close(engine), close(callbacks), close(provider)]);
  }
});
