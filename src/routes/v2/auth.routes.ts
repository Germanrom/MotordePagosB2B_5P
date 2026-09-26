import { Router } from 'express';
import { getMpAccount, getMpUrl, mpCallback } from '../../controllers/v2/auth.controller';
import { verifyApiKey } from '../../middlewares/v2/auth';

const router = Router();

// GET /auth/mp-url - Protegido por API Key, devuelve URL de MP
router.get('/mp-url', verifyApiKey, getMpUrl);
router.get('/account', verifyApiKey, getMpAccount);

// GET /auth/callback - Público, lo llama Mercado Pago al terminar OAuth
router.get('/callback', mpCallback);

export default router;
