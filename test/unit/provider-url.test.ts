import assert from 'node:assert/strict';
import test from 'node:test';
import { mercadoPagoApiUrl } from '../../src/services/mercadopago/api-url';

test('Mercado Pago API URLs use the official endpoint by default', () => {
  const previous = process.env.MP_API_BASE_URL;
  delete process.env.MP_API_BASE_URL;
  try {
    assert.equal(mercadoPagoApiUrl('/v1/payments'), 'https://api.mercadopago.com/v1/payments');
  } finally {
    if (previous === undefined) delete process.env.MP_API_BASE_URL;
    else process.env.MP_API_BASE_URL = previous;
  }
});

test('Mercado Pago API URL supports a local provider simulator for E2E flows', () => {
  const previous = process.env.MP_API_BASE_URL;
  process.env.MP_API_BASE_URL = 'http://127.0.0.1:4567/';
  try {
    assert.equal(mercadoPagoApiUrl('/oauth/token'), 'http://127.0.0.1:4567/oauth/token');
  } finally {
    if (previous === undefined) delete process.env.MP_API_BASE_URL;
    else process.env.MP_API_BASE_URL = previous;
  }
});

test('OAuth state hashes are one-way and deterministic', async () => {
  const { hashOAuthState } = await import('../../src/services/mercadopago/oauth.service');
  assert.equal(hashOAuthState('random-state'), hashOAuthState('random-state'));
  assert.notEqual(hashOAuthState('random-state'), 'random-state');
});
