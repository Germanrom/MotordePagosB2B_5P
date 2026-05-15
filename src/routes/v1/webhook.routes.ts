import { Router } from 'express';
import { handleWebhook } from '../../controllers/v1/webhook.controller';

const router = Router();

// POST /webhook - Público (protegido internamente por firma de MP)
router.post('/', handleWebhook);

export default router;
