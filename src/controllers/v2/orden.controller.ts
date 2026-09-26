import { Request, Response } from 'express';
import { getTenantOrderStatus } from '../../services/payments/brick-payment.service';

export const getOrderStatusV2 = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const order = await getTenantOrderStatus(req.client!.id, id);
    if (!order) { res.status(404).json({ error: 'order_not_found', message: 'Order was not found for this tenant' }); return; }
    res.json(order);
  } catch (error) {
    console.error('Could not read V2 order status:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: 'internal_error', message: 'Could not read order status' });
  }
};
