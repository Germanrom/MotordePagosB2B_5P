import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { close, listen } from '../helpers/http-server';

test('public API contract exposes health, security headers, V1 deprecation, and no POC route', async () => {
  const { app } = await import('../../src/app');
  const server = createServer(app);
  const baseUrl = await listen(server);
  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-powered-by'), null);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.equal(health.headers.get('referrer-policy'), 'no-referrer');

    const deprecated = await fetch(`${baseUrl}/v1/ordenes`, { method: 'POST' });
    assert.ok(deprecated.headers.get('deprecation'));
    assert.ok(deprecated.headers.get('x-api-deprecation-info'));

    const poc = await fetch(`${baseUrl}/api/poc`);
    assert.equal(poc.status, 404);
  } finally {
    await close(server);
  }
});

test('protected V2 endpoints reject a missing API key before accessing tenant data', async () => {
  const { app } = await import('../../src/app');
  const server = createServer(app);
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v2/auth/account`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: 'api_key_required', message: 'X-API-Key is required' } });
  } finally {
    await close(server);
  }
});

test('JSON payloads above the configured limit are rejected before route execution', async () => {
  const { app } = await import('../../src/app');
  const server = createServer(app);
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v2/pagos/brick`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(70_000) }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: { code: 'payload_too_large', message: 'JSON request body cannot exceed 64 KB' } });
  } finally {
    await close(server);
  }
});

test('malformed JSON gets a stable client error response', async () => {
  const { app } = await import('../../src/app');
  const server = createServer(app);
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v2/pagos/brick`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"invalid":',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: 'invalid_json', message: 'Request body must contain valid JSON' } });
  } finally {
    await close(server);
  }
});
