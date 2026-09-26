import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { fingerprintRequest, hashApiKey, hashCallbackSignature } from '../../src/services/security/credentials';
import { decryptSecret, encryptSecret } from '../../src/services/security/secret-crypto';
import { validateMpWebhookSignature } from '../../src/services/mercadopago/webhook-signature';

const key = Buffer.alloc(32, 13).toString('base64');

test('encryption uses a fresh nonce for every stored secret', () => {
  const one = encryptSecret('same-token', key);
  const two = encryptSecret('same-token', key);
  assert.notEqual(one, two);
  assert.equal(decryptSecret(one, key), 'same-token');
  assert.equal(decryptSecret(two, key), 'same-token');
});

test('legacy credentials remain readable while the backfill is in progress', () => {
  assert.equal(decryptSecret('legacy-plain-token', key), 'legacy-plain-token');
});

test('encryption rejects keys that do not decode to exactly 32 bytes', () => {
  assert.throws(() => encryptSecret('secret', Buffer.alloc(16, 1).toString('base64')), /32-byte/);
  assert.throws(() => decryptSecret('enc:v1:a:b:c', 'invalid-key'), /32-byte/);
});

test('decryption rejects malformed and tampered encrypted values', () => {
  const stored = encryptSecret('sensitive-value', key);
  const parts = stored.split(':');
  assert.throws(() => decryptSecret('enc:v1:broken', key), /invalid format/);
  parts[4] = Buffer.from('tampered-value').toString('base64');
  assert.throws(() => decryptSecret(parts.join(':'), key));
});

test('API key hashes are deterministic and distinct from plaintext', () => {
  assert.equal(hashApiKey('tenant-api-key'), hashApiKey('tenant-api-key'));
  assert.notEqual(hashApiKey('tenant-api-key'), hashApiKey('another-api-key'));
  assert.notEqual(hashApiKey('tenant-api-key'), 'tenant-api-key');
});

test('request fingerprints sort object keys recursively but preserve array order', () => {
  const first = { payer: { email: 'buyer@example.com', name: 'Ada' }, data: [1, 2] };
  const reordered = { data: [1, 2], payer: { name: 'Ada', email: 'buyer@example.com' } };
  assert.equal(fingerprintRequest(first), fingerprintRequest(reordered));
  assert.notEqual(fingerprintRequest(first), fingerprintRequest({ ...first, data: [2, 1] }));
});

test('callback signature is stable when JSON storage changes object key order', () => {
  const payload = { event_id: 'mp-1:PENDING>APPROVED', estado: 'approved' };
  const expected = createHmac('sha256', 'tenant-secret')
    .update('{"estado":"approved","event_id":"mp-1:PENDING>APPROVED"}')
    .digest('hex');
  assert.equal(hashCallbackSignature(payload, 'tenant-secret'), expected);
  assert.equal(hashCallbackSignature({ estado: 'approved', event_id: payload.event_id }, 'tenant-secret'), expected);
  assert.notEqual(hashCallbackSignature({ ...payload, estado: 'rejected' }, 'tenant-secret'), expected);
});

test('Mercado Pago webhook signature rejects missing fields and missing secret', () => {
  assert.equal(validateMpWebhookSignature(undefined, 'request', '42', 'secret'), false);
  assert.equal(validateMpWebhookSignature('ts=1,v1=abc', undefined, '42', 'secret'), false);
  assert.equal(validateMpWebhookSignature('ts=1,v1=abc', 'request', '', 'secret'), false);
  assert.equal(validateMpWebhookSignature('ts=1,v1=abc', 'request', '42', undefined), false);
});

test('Mercado Pago webhook signature rejects stale and future timestamps', () => {
  const now = 1_700_000_000;
  for (const timestamp of [now - 86_401, now + 86_401]) {
    assert.equal(validateMpWebhookSignature(`ts=${timestamp},v1=${'a'.repeat(64)}`, 'request', '42', 'secret', now), false);
  }
});

test('Mercado Pago webhook signature uses the lowercased payment ID in its manifest', () => {
  const timestamp = 1_700_000_000;
  const requestId = 'request-01';
  const digest = createHmac('sha256', 'secret')
    .update(`id:abc123;request-id:${requestId};ts:${timestamp};`)
    .digest('hex');
  assert.equal(validateMpWebhookSignature(`ts=${timestamp},v1=${digest}`, requestId, 'ABC123', 'secret', timestamp), true);
});

test('Mercado Pago webhook signature rejects malformed hexadecimal signatures', () => {
  assert.equal(validateMpWebhookSignature('ts=1700000000,v1=xyz', 'request', '42', 'secret', 1_700_000_000), false);
  assert.equal(validateMpWebhookSignature('ts=not-a-time,v1=abcd', 'request', '42', 'secret'), false);
});
