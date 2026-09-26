import { Router } from 'express';
import { handleWebhookV2 } from '../../controllers/v2/webhook.controller';

const router = Router();

// POST /webhook - Público (protegido internamente por firma de MP)
router.post('/mercadopago', handleWebhookV2);

export default router;
