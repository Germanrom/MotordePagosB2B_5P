import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPaymentMatchesOrder, normalizePaymentStatus } from '../../src/services/payments/reconciliation';
import { parseBrickPaymentInput, PaymentOperationError } from '../../src/services/payments/brick-payment.service';

const brickRequest = () => ({
  external_id: 'order-001',
  concepto: 'Order 001',
  transaction_amount: 2500.25,
  token: 'brick-token',
  installments: 1,
  payment_method_id: 'visa',
  payer: { email: 'buyer@example.com' },
});

test('Brick request defaults currency and accepts supported optional payer fields', () => {
  const result = parseBrickPaymentInput({
    ...brickRequest(),
    issuer_id: 123,
    payer: { email: 'buyer@example.com', first_name: 'Ada', identification: { type: 'DNI', number: '12345678' } },
  });
  assert.equal(result.currency_id, 'ARS');
  assert.equal(result.issuer_id, 123);
  assert.equal(result.payer.identification?.number, '12345678');
});

test('Brick request rejects extra root and nested fields', () => {
  assert.throws(() => parseBrickPaymentInput({ ...brickRequest(), vendor_id: 1 }), PaymentOperationError);
  assert.throws(() => parseBrickPaymentInput({ ...brickRequest(), payer: { email: 'buyer@example.com', customer_id: 'x' } }), PaymentOperationError);
});

test('Brick request rejects invalid identifiers, text, email, and payment token', () => {
  for (const body of [
    { ...brickRequest(), external_id: '' },
    { ...brickRequest(), concepto: '   ' },
    { ...brickRequest(), token: '' },
    { ...brickRequest(), payment_method_id: '' },
    { ...brickRequest(), payer: { email: 'not-an-email' } },
  ]) assert.throws(() => parseBrickPaymentInput(body), PaymentOperationError);
});

test('Brick request rejects invalid amounts, unsupported currency, and fractional cents', () => {
  for (const body of [
    { ...brickRequest(), transaction_amount: 0 },
    { ...brickRequest(), transaction_amount: -1 },
    { ...brickRequest(), transaction_amount: 10.001 },
    { ...brickRequest(), transaction_amount: 100_000_001 },
    { ...brickRequest(), currency_id: 'USD' },
  ]) assert.throws(() => parseBrickPaymentInput(body), PaymentOperationError);
});

test('Brick request only accepts integer installments from one through 24', () => {
  assert.equal(parseBrickPaymentInput({ ...brickRequest(), installments: 24 }).installments, 24);
  for (const installments of [0, 1.5, 25]) {
    assert.throws(() => parseBrickPaymentInput({ ...brickRequest(), installments }), PaymentOperationError);
  }
});

test('payment status mapping distinguishes supported in-flight and terminal states', () => {
  assert.equal(normalizePaymentStatus('pending'), 'PENDING');
  assert.equal(normalizePaymentStatus('in_process'), 'PENDING');
  assert.equal(normalizePaymentStatus('authorized'), 'PENDING');
  assert.equal(normalizePaymentStatus('approved'), 'APPROVED');
  assert.equal(normalizePaymentStatus('rejected'), 'REJECTED');
  assert.equal(normalizePaymentStatus('cancelled'), 'CANCELLED');
  assert.equal(normalizePaymentStatus('refunded'), 'REFUNDED');
  assert.equal(normalizePaymentStatus('charged_back'), 'CHARGED_BACK');
  assert.equal(normalizePaymentStatus('new_mp_status'), null);
});

test('payment reconciliation accepts exact matching provider values', () => {
  assert.doesNotThrow(() => assertPaymentMatchesOrder(
    { vendorId: 2, amount: '99.90', currency: 'ARS', externalReference: 'order-1' },
    { collectorId: '44', transactionAmount: '99.9', currencyId: 'ARS', externalReference: 'order-1' },
    44,
  ));
});

test('payment reconciliation rejects each field that could route or settle funds incorrectly', () => {
  const order = { vendorId: 2, amount: '99.90', currency: 'ARS', externalReference: 'order-1' };
  const payment = { collectorId: '44', transactionAmount: '99.90', currencyId: 'ARS', externalReference: 'order-1' };
  assert.throws(() => assertPaymentMatchesOrder(order, { ...payment, collectorId: '45' }, '44'), /collector/);
  assert.throws(() => assertPaymentMatchesOrder(order, { ...payment, transactionAmount: '100.00' }, '44'), /amount/);
  assert.throws(() => assertPaymentMatchesOrder(order, { ...payment, currencyId: 'USD' }, '44'), /currency/);
  assert.throws(() => assertPaymentMatchesOrder(order, { ...payment, externalReference: 'another-order' }, '44'), /reference/);
});

test('payment reconciliation rejects provider amounts that differ below one cent', () => {
  const order = { vendorId: 2, amount: '10.00', currency: 'ARS', externalReference: 'order-cent' };
  const payment = { collectorId: '44', transactionAmount: '10.001', currencyId: 'ARS', externalReference: 'order-cent' };
  assert.throws(() => assertPaymentMatchesOrder(order, payment, '44'), /amount/);
});

test('payment reconciliation compares decimal amounts without binary floating-point rounding', () => {
  const order = { vendorId: 2, amount: '0.29', currency: 'ARS', externalReference: 'order-float' };
  const payment = { collectorId: '44', transactionAmount: 0.29, currencyId: 'ARS', externalReference: 'order-float' };
  assert.doesNotThrow(() => assertPaymentMatchesOrder(order, payment, '44'));
});
