import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mercadoPagoApiUrl } from '../src/services/mercadopago/api-url';

type ProviderResponse = Record<string, unknown>;

const token = process.env.MP_SAAS_TEST_ACCESS_TOKEN ?? '';
if (!token.startsWith('TEST-')) {
  throw new Error('MP_SAAS_TEST_ACCESS_TOKEN must be a Mercado Pago TEST token');
}

const api = async (path: string, method = 'GET', body?: unknown): Promise<ProviderResponse> => {
  const response = await fetch(mercadoPagoApiUrl(path), {
    method,
    signal: AbortSignal.timeout(12_000),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json() as ProviderResponse;
  if (!response.ok) {
    throw new Error(`Mercado Pago ${method} ${path} returned ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
};

const requireAmount = (raw: string | undefined): number => {
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error('Provide a positive ARS amount with at most two decimals');
  }
  return amount;
};

const command = process.argv[2];

const run = async (): Promise<void> => {
  if (command === 'create-plan') {
    const amount = requireAmount(process.argv[3]);
    const backUrl = process.env.MP_SAAS_TEST_BACK_URL;
    if (!backUrl || new URL(backUrl).protocol !== 'https:') throw new Error('MP_SAAS_TEST_BACK_URL must be an HTTPS URL');
    const plan = await api('/preapproval_plan', 'POST', {
      reason: `FivePeaks calendar probe ${randomUUID()}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        billing_day: 5,
        billing_day_proportional: false,
        transaction_amount: amount,
        currency_id: 'ARS',
      },
      back_url: backUrl,
    });
    console.log(JSON.stringify({ id: plan.id, status: plan.status, auto_recurring: plan.auto_recurring }, null, 2));
    return;
  }

  if (command === 'create-checkout') {
    const planId = process.argv[3];
    const payerEmail = process.env.MP_SAAS_TEST_PAYER_EMAIL;
    const backUrl = process.env.MP_SAAS_TEST_BACK_URL;
    if (!planId || !payerEmail || !backUrl) throw new Error('Provide plan ID, MP_SAAS_TEST_PAYER_EMAIL and MP_SAAS_TEST_BACK_URL');
    const preapproval = await api('/preapproval', 'POST', {
      preapproval_plan_id: planId,
      payer_email: payerEmail,
      external_reference: `fivepeaks-probe-${randomUUID()}`,
      back_url: backUrl,
      status: 'pending',
    });
    console.log(JSON.stringify({
      id: preapproval.id,
      status: preapproval.status,
      init_point: preapproval.init_point,
      next_payment_date: preapproval.next_payment_date,
      auto_recurring: preapproval.auto_recurring,
    }, null, 2));
    return;
  }

  if (command === 'create-checkout-no-plan') {
    const amount = requireAmount(process.argv[3]);
    const payerEmail = process.env.MP_SAAS_TEST_PAYER_EMAIL;
    const backUrl = process.env.MP_SAAS_TEST_BACK_URL;
    if (!payerEmail || !backUrl) throw new Error('Set MP_SAAS_TEST_PAYER_EMAIL and MP_SAAS_TEST_BACK_URL');
    const preapproval = await api('/preapproval', 'POST', {
      reason: 'FivePeaks monthly calendar probe',
      external_reference: `fivepeaks-probe-${randomUUID()}`,
      payer_email: payerEmail,
      back_url: backUrl,
      status: 'pending',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: amount,
        currency_id: 'ARS',
      },
    });
    console.log(JSON.stringify({
      id: preapproval.id,
      status: preapproval.status,
      init_point: preapproval.init_point,
      next_payment_date: preapproval.next_payment_date,
      auto_recurring: preapproval.auto_recurring,
    }, null, 2));
    return;
  }

  if (command === 'set-billing-day') {
    const id = process.argv[3];
    if (!id) throw new Error('Provide preapproval ID');
    const before = await api(`/preapproval/${encodeURIComponent(id)}`);
    const updated = await api(`/preapproval/${encodeURIComponent(id)}`, 'PUT', {
      auto_recurring: { billing_day: 5, billing_day_proportional: false },
    });
    console.log(JSON.stringify({
      before: { status: before.status, next_payment_date: before.next_payment_date, auto_recurring: before.auto_recurring },
      after: { status: updated.status, next_payment_date: updated.next_payment_date, auto_recurring: updated.auto_recurring },
    }, null, 2));
    return;
  }

  if (command === 'inspect') {
    const id = process.argv[3];
    if (!id) throw new Error('Provide preapproval ID');
    const subscription = await api(`/preapproval/${encodeURIComponent(id)}`);
    const invoices = await api(`/authorized_payments/search?preapproval_id=${encodeURIComponent(id)}`);
    console.log(JSON.stringify({
      subscription: {
        id: subscription.id,
        status: subscription.status,
        collector_id: subscription.collector_id,
        next_payment_date: subscription.next_payment_date,
        auto_recurring: subscription.auto_recurring,
      },
      invoices: (invoices.results as ProviderResponse[] | undefined)?.map((invoice) => ({
        id: invoice.id,
        debit_date: invoice.debit_date,
        status: invoice.status,
        summarized: invoice.summarized,
        transaction_amount: invoice.transaction_amount,
        payment: invoice.payment,
      })) ?? [],
    }, null, 2));
    return;
  }

  throw new Error('Usage: create-plan <amount> | create-checkout <plan-id> | create-checkout-no-plan <amount> | set-billing-day <preapproval-id> | inspect <preapproval-id>');
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
