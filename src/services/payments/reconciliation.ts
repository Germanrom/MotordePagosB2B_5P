export type OrderPaymentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED' | 'CHARGED_BACK';

export interface ExpectedPayment {
  vendorId: number;
  amount: string | number;
  currency: string;
  externalReference: string;
}

export interface MercadoPagoPaymentSnapshot {
  collectorId: number | string;
  transactionAmount: number | string;
  currencyId: string;
  externalReference: string;
}

const toMinorUnits = (value: string | number): bigint | null => {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  if (/[1-9]/.test(fraction.slice(2))) return null;
  const cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0') || '0');
  return sign === '-' ? -cents : cents;
};

export const normalizePaymentStatus = (status: string): OrderPaymentStatus | null => {
  switch (status) {
    case 'approved': return 'APPROVED';
    case 'rejected': return 'REJECTED';
    case 'cancelled': return 'CANCELLED';
    case 'refunded': return 'REFUNDED';
    case 'charged_back': return 'CHARGED_BACK';
    case 'pending': return 'PENDING';
    case 'in_process': return 'PENDING';
    case 'authorized': return 'PENDING';
    default: return null;
  }
};

export const assertPaymentMatchesOrder = (
  order: ExpectedPayment,
  payment: MercadoPagoPaymentSnapshot,
  expectedCollectorId: number | string,
): void => {
  if (String(payment.collectorId) !== String(expectedCollectorId)) throw new Error('Mercado Pago collector does not match the assigned account');
  const expectedAmount = toMinorUnits(order.amount);
  const receivedAmount = toMinorUnits(payment.transactionAmount);
  if (expectedAmount === null || receivedAmount === null || receivedAmount !== expectedAmount) throw new Error('Mercado Pago amount does not match the order amount');
  if (payment.currencyId !== order.currency) throw new Error('Mercado Pago currency does not match the order currency');
  if (payment.externalReference !== order.externalReference) throw new Error('Mercado Pago reference does not match the order reference');
};
