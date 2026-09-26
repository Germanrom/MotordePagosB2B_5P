import assert from 'node:assert/strict';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
export const testDatabaseReady = Boolean(testDatabaseUrl);

if (testDatabaseUrl) {
  const parsed = new URL(testDatabaseUrl);
  assert.equal(parsed.pathname.replace(/^\//, ''), 'motor_pagos_test', 'TEST_DATABASE_URL must target the dedicated motor_pagos_test database');
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DIRECT_URL = testDatabaseUrl;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  process.env.MP_WEBHOOK_SECRET = 'test-mp-webhook-secret';
}
