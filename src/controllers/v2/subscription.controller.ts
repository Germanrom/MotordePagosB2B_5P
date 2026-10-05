import type { Request, Response } from 'express';
import { createSubscriptionCheckout, getSubscriptionForClient, parseCheckoutInput, SubscriptionOperationError } from '../../services/subscriptions/subscription-checkout.service';

export const startSubscriptionCheckout = async (req: Request, res: Response): Promise<void> => {
  try {
    const input = parseCheckoutInput(req.body);
    const result = await createSubscriptionCheckout(req.client!, input, req.header('Idempotency-Key') ?? '');
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof SubscriptionOperationError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    console.error('Subscription checkout failed:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: { code: 'internal_error', message: 'Could not start the subscription checkout' } });
  }
};

export const getSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const row = await getSubscriptionForClient(req.client!.id, id);
    if (!row) { res.status(404).json({ error: { code: 'subscription_not_found', message: 'Subscription was not found' } }); return; }
    res.json({
      subscription_id: row.id,
      external_tenant_id: row.external_tenant_id,
      status: row.status.toLowerCase(),
      provider_status: row.provider_status,
      plan_code: row.plan_code,
      plan_version: row.plan_version,
      amount: row.amount.toFixed(2),
      currency: row.currency,
      first_paid_at: row.first_paid_at,
      next_payment_at: row.next_payment_at,
      paid_through: row.paid_through,
      latest_period: row.periods[0] ?? null,
    });
  } catch (error) {
    console.error('Subscription lookup failed:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: { code: 'internal_error', message: 'Could not read subscription' } });
  }
};
