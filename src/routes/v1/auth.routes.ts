import { Router } from 'express';
// FIJATE BIEN: Acá están los DOS saltos ../../
import { getMpUrl, mpCallback } from '../../controllers/v1/auth.controller';
import { verifyApiKey } from '../../middlewares/v1/auth';

const router = Router();

router.get('/mp-url', verifyApiKey, getMpUrl);
router.get('/callback', mpCallback);

export default router;