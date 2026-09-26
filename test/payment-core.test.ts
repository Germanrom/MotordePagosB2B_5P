import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { decryptSecret, encryptSecret } from '../src/services/security/secret-crypto';
import { fingerprintRequest, hashApiKey } from '../src/services/security/credentials';
import { validateMpWebhookSignature } from '../src/services/mercadopago/webhook-signature';
import { assertPaymentMatchesOrder, normalizePaymentStatus } from '../src/services/payments/reconciliation';
import { parseBrickPaymentInput, PaymentOperationError } from '../src/services/payments/brick-payment.service';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');

test('credential encryption is authenticated and decrypts with the configured key', () => {
  const stored = encryptSecret('APP_USR-secret-token', encryptionKey);

  assert.notEqual(stored, 'APP_USR-secret-token');
  assert.equal(decryptSecret(stored, encryptionKey), 'APP_USR-secret-token');
  assert.throws(() => decryptSecret(stored, Buffer.alloc(32, 8).toString('base64')));
});

test('API keys are stored as one-way hashes and request fingerprint ignores object key order', () => {
  assert.notEqual(hashApiKey('client-secret'), 'client-secret');
  assert.equal(fingerprintRequest({ amount: 10, payer: { email: 'a@b.com' } }), fingerprintRequest({ payer: { email: 'a@b.com' }, amount: 10 }));
  assert.notEqual(fingerprintRequest({ amount: 10 }), fingerprintRequest({ amount: 11 }));
});

test('Mercado Pago webhook signatures validate only the query data.id and reject malformed input', () => {
  const secret = 'mp-webhook-secret';
  const dataId = '123456789';
  const requestId = 'request-123';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const digest = createHmac('sha256', secret).update(manifest).digest('hex');

  assert.equal(validateMpWebhookSignature(`ts=${timestamp},v1=${digest}`, requestId, dataId, secret), true);
  assert.equal(validateMpWebhookSignature(`ts=${timestamp},v1=bad`, requestId, dataId, secret), false);
  assert.equal(validateMpWebhookSignature(`ts=${timestamp},v1=${digest}`, requestId, '', secret), false);
  assert.equal(validateMpWebhookSignature(`ts=1,v1=${digest}`, requestId, dataId, secret), false);
});

test('payment reconciliation rejects cross-account and amount/currency mismatches', () => {
  const order = { vendorId: 4, amount: '1200.00', currency: 'ARS', externalReference: 'order-1' };
  const payment = { collectorId: 44, transactionAmount: 1200, currencyId: 'ARS', externalReference: 'order-1' };

  assert.doesNotThrow(() => assertPaymentMatchesOrder(order, payment, 44));
  assert.throws(() => assertPaymentMatchesOrder(order, payment, 45), /collector/i);
  assert.throws(() => assertPaymentMatchesOrder({ ...order, amount: '1200.01' }, payment, 44), /amount/i);
  assert.throws(() => assertPaymentMatchesOrder({ ...order, currency: 'USD' }, payment, 44), /currency/i);
  assert.throws(() => assertPaymentMatchesOrder(order, { ...payment, externalReference: 'order-2' }, 44), /reference/i);
});

test('provider payment statuses map to the persisted order lifecycle', () => {
  assert.equal(normalizePaymentStatus('approved'), 'APPROVED');
  assert.equal(normalizePaymentStatus('in_process'), 'PENDING');
  assert.equal(normalizePaymentStatus('rejected'), 'REJECTED');
  assert.equal(normalizePaymentStatus('cancelled'), 'CANCELLED');
  assert.equal(normalizePaymentStatus('refunded'), 'REFUNDED');
  assert.equal(normalizePaymentStatus('charged_back'), 'CHARGED_BACK');
  assert.equal(normalizePaymentStatus('unknown-provider-status'), null);
});

test('Brick input requires an external reference and rejects account selectors and fractional cents', () => {
  const valid = {
    external_id: 'invoice-123', concepto: 'Invoice 123', transaction_amount: 1200.5,
    currency_id: 'ARS', token: 'brick-token', installments: 1, payment_method_id: 'visa',
    payer: { email: 'buyer@example.com' },
  };
  assert.equal(parseBrickPaymentInput(valid).external_id, 'invoice-123');
  assert.throws(() => parseBrickPaymentInput({ ...valid, vendor_id: 42 }), PaymentOperationError);
  assert.throws(() => parseBrickPaymentInput({ ...valid, transaction_amount: 1200.501 }), PaymentOperationError);
});
