import { Prisma, PrismaClient, type SaasSubscription } from '@prisma/client';
import prisma from '../../config/prisma';
import { enqueueSubscriptionCallback } from './subscription-callback.service';
import { expectedSaasCollector, requestSaasProvider, saasProviderToken } from './subscription-checkout.service';

type ProviderResource = Record<string, any>;
type ProviderFetch = typeof fetch;

const providerDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sameAmount = (actual: unknown, expected: Prisma.Decimal): boolean => {
  try { return new Prisma.Decimal(String(actual)).eq(expected); } catch { return false; }
};

export const assertSaasSubscriptionResource = (remote: ProviderResource, local: SaasSubscription, collectorId: string): void => {
  if (String(remote.id ?? '') !== local.provider_preapproval_id && local.provider_preapproval_id) throw new Error('Preapproval ID mismatch');
  if (String(remote.external_reference ?? '') !== local.id
    || String(remote.collector_id ?? '') !== collectorId
    || String(remote.auto_recurring?.currency_id ?? '') !== local.currency
    || !sameAmount(remote.auto_recurring?.transaction_amount, local.amount)) {
    throw new Error('Mercado Pago subscription does not match the local account, reference, amount, or currency');
  }
};

const loadSubscription = async (remote: ProviderResource, db: PrismaClient): Promise<SaasSubscription> => {
  const providerId = String(remote.id ?? '');
  const reference = String(remote.external_reference ?? '');
  const local = await db.saasSubscription.findFirst({ where: { OR: [{ provider_preapproval_id: providerId }, { id: reference }] } });
  if (!local) throw new Error('Unknown FivePeaks subscription reference');
  assertSaasSubscriptionResource(remote, local, expectedSaasCollector());
  return local;
};

const syncPreapproval = async (
  providerId: string,
  db: PrismaClient,
  providerFetch: ProviderFetch,
): Promise<{ local: SaasSubscription; remote: ProviderResource }> => {
  const remote = await requestSaasProvider(`/preapproval/${encodeURIComponent(providerId)}`, saasProviderToken(), providerFetch);
  const local = await loadSubscription(remote, db);
  const nextPayment = providerDate(remote.next_payment_date);
  await db.$transaction(async (tx) => {
    const current = await tx.saasSubscription.findUniqueOrThrow({ where: { id: local.id }, include: { client: true } });
    if (current.provider_preapproval_id && current.provider_preapproval_id !== providerId) throw new Error('Subscription is bound to another provider resource');
    const providerStatus = String(remote.status ?? '');
    if (!['pending', 'authorized', 'paused', 'cancelled', 'canceled'].includes(providerStatus)) throw new Error('Unknown provider subscription status');
    const becameAuthorized = providerStatus === 'authorized' && !current.first_paid_at
      && ['CREATING', 'RECONCILIATION_REQUIRED', 'PENDING_CHECKOUT'].includes(current.status);
    const nextStatus = becameAuthorized ? 'AUTHORIZED' : current.status;
    await tx.saasSubscription.update({ where: { id: current.id }, data: {
      provider_preapproval_id: providerId,
      provider_status: providerStatus,
      checkout_url: current.checkout_url ?? (typeof remote.init_point === 'string' ? remote.init_point : null),
      next_payment_at: nextPayment ?? current.next_payment_at,
      status: nextStatus,
    } });
    if (becameAuthorized) {
      await enqueueSubscriptionCallback(tx, current.client, current, `subscription:${current.id}:authorized`, 'subscription.authorized', {
        provider_preapproval_id: providerId,
        payment_confirmed: false,
      });
    }
  });
  return { local, remote };
};

const assertInvoice = (invoice: ProviderResource, local: SaasSubscription, providerId: string): void => {
  if (String(invoice.preapproval_id ?? '') !== providerId
    || String(invoice.external_reference ?? '') !== local.id
    || String(invoice.currency_id ?? '') !== local.currency
    || !sameAmount(invoice.transaction_amount, local.amount)
    || !invoice.id) throw new Error('Mercado Pago invoice does not match the subscription');
};

const assertPayment = (payment: ProviderResource, invoice: ProviderResource, local: SaasSubscription): void => {
  if (String(payment.id ?? '') !== String(invoice.payment?.id ?? '')
    || String(payment.collector_id ?? '') !== expectedSaasCollector()
    || String(payment.external_reference ?? '') !== local.id
    || String(payment.currency_id ?? '') !== local.currency
    || !sameAmount(payment.transaction_amount, local.amount)) {
    throw new Error('Mercado Pago payment does not match the subscription invoice');
  }
};

export const reconcileSaasInvoice = async (invoiceId: string, db: PrismaClient = prisma, providerFetch: ProviderFetch = fetch): Promise<string> => {
  const token = saasProviderToken();
  const invoice = await requestSaasProvider(`/authorized_payments/${encodeURIComponent(invoiceId)}`, token, providerFetch);
  const providerId = String(invoice.preapproval_id ?? '');
  if (!providerId || String(invoice.id ?? '') !== invoiceId) throw new Error('Invoice identity is missing or mismatched');
  const { local, remote } = await syncPreapproval(providerId, db, providerFetch);
  assertInvoice(invoice, local, providerId);
  const periodStart = providerDate(invoice.debit_date) ?? providerDate(invoice.date_created);
  if (!periodStart) throw new Error('Invoice has no valid debit or creation date');
  const paymentId = invoice.payment?.id === undefined || invoice.payment?.id === null ? null : String(invoice.payment.id);
  if (!paymentId) return local.id; // Scheduled invoice; a later invoice/payment notification will reconcile it.
  const payment = await requestSaasProvider(`/v1/payments/${encodeURIComponent(paymentId)}`, token, providerFetch);
  assertPayment(payment, invoice, local);
  const status = String(payment.status ?? '');
  if (!['approved', 'rejected', 'pending', 'in_process', 'cancelled', 'refunded', 'charged_back'].includes(status)) {
    throw new Error(`Unsupported subscription payment status: ${status || 'missing'}`);
  }
  const paidAt = status === 'approved' ? providerDate(payment.date_approved) : null;
  if (status === 'approved' && !paidAt) throw new Error('Approved payment has no date_approved');
  const nextPayment = providerDate(remote.next_payment_date);
  if (status === 'approved' && (!nextPayment || nextPayment <= paidAt!)) {
    throw new Error('Approved subscription has no future next_payment_date');
  }
  const periodEnd = nextPayment && nextPayment > periodStart ? nextPayment : null;

  await db.$transaction(async (tx) => {
    const current = await tx.saasSubscription.findUniqueOrThrow({ where: { id: local.id }, include: { client: true } });
    const existingPeriod = await tx.saasBillingPeriod.findUnique({ where: { provider_invoice_id: invoiceId } });
    if (existingPeriod && existingPeriod.subscription_id !== current.id) throw new Error('Invoice belongs to another subscription');
    const period = await tx.saasBillingPeriod.upsert({ where: { provider_invoice_id: invoiceId },
      create: {
        subscription_id: current.id, provider_invoice_id: invoiceId, period_start: periodStart, period_end: periodEnd,
        amount: current.amount, currency: current.currency, status: status === 'approved' ? 'APPROVED' : status.toUpperCase(),
      },
      update: {
        period_end: periodEnd ?? existingPeriod?.period_end,
        status: status === 'approved' ? 'APPROVED' : existingPeriod?.status === 'APPROVED' ? 'APPROVED' : status.toUpperCase(),
      },
    });
    const existingPayment = await tx.saasPaymentAttempt.findUnique({ where: { provider_payment_id: paymentId } });
    if (existingPayment && existingPayment.period_id !== period.id) throw new Error('Payment belongs to another subscription invoice');
    await tx.saasPaymentAttempt.upsert({ where: { provider_payment_id: paymentId },
      create: { period_id: period.id, provider_payment_id: paymentId, provider_status: status,
        status_detail: String(payment.status_detail ?? '') || null, amount: current.amount, currency: current.currency, paid_at: paidAt },
      update: { provider_status: status, status_detail: String(payment.status_detail ?? '') || null, paid_at: paidAt },
    });

    if (status === 'approved' && paidAt && nextPayment) {
      const activated = await tx.saasSubscription.updateMany({ where: { id: current.id, first_paid_at: null }, data: {
        first_paid_at: paidAt, paid_through: nextPayment, next_payment_at: nextPayment, status: 'ACTIVE', provider_status: String(remote.status),
      } });
      if (activated.count) {
        await enqueueSubscriptionCallback(tx, current.client, current, `subscription:${current.id}:first-payment:approved`, 'subscription.payment_approved', {
          first_payment: true, provider_preapproval_id: providerId, provider_invoice_id: invoiceId,
          provider_payment_id: paymentId, paid_at: paidAt.toISOString(), period_start: periodStart.toISOString(),
          period_end: nextPayment.toISOString(), next_payment_at: nextPayment.toISOString(),
        });
      }
    } else if (status === 'rejected' && !current.first_paid_at && existingPayment?.provider_status !== 'rejected') {
      await enqueueSubscriptionCallback(tx, current.client, current, `subscription:${current.id}:first-payment:${paymentId}:rejected`, 'subscription.payment_rejected', {
        first_payment: true, provider_preapproval_id: providerId, provider_invoice_id: invoiceId,
        provider_payment_id: paymentId, period_start: periodStart.toISOString(),
      });
    }
  });
  return local.id;
};

export const reconcileSaasNotification = async (
  topic: string,
  resourceId: string,
  db: PrismaClient = prisma,
  providerFetch: ProviderFetch = fetch,
): Promise<string> => {
  if (topic === 'subscription_authorized_payment') return reconcileSaasInvoice(resourceId, db, providerFetch);
  if (topic === 'subscription_preapproval') {
    const { local } = await syncPreapproval(resourceId, db, providerFetch);
    if (!local.first_paid_at) {
      const search = await requestSaasProvider(`/authorized_payments/search?preapproval_id=${encodeURIComponent(resourceId)}`, saasProviderToken(), providerFetch);
      const invoices = Array.isArray(search.results) ? search.results : [];
      for (const invoice of invoices) {
        if (invoice.payment?.id) await reconcileSaasInvoice(String(invoice.id), db, providerFetch);
      }
    }
    return local.id;
  }
  if (topic === 'payment') {
    const search = await requestSaasProvider(`/authorized_payments/search?payment_id=${encodeURIComponent(resourceId)}`, saasProviderToken(), providerFetch);
    const invoices = (Array.isArray(search.results) ? search.results : []).filter((invoice: ProviderResource) => String(invoice.payment?.id ?? '') === resourceId);
    if (invoices.length !== 1) throw new Error('Payment is not yet mapped to exactly one subscription invoice');
    return reconcileSaasInvoice(String(invoices[0].id), db, providerFetch);
  }
  throw new Error(`Unsupported subscription webhook topic: ${topic}`);
};
