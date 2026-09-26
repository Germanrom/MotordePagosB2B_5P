import { Request, Response } from 'express';
import { createBrickPayment, parseBrickPaymentInput, PaymentOperationError } from '../../services/payments/brick-payment.service';

export const procesarPagoBrick = async (req: Request, res: Response): Promise<void> => {
  try {
    const idempotencyKey = req.header('Idempotency-Key') ?? '';
    const input = parseBrickPaymentInput(req.body);
    const result = await createBrickPayment(req.client!, input, idempotencyKey);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof PaymentOperationError) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    console.error('Brick payment failed:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: 'internal_error', message: 'Could not process this payment' });
  }
};
