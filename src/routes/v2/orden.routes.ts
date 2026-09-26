import { Router } from 'express';
import { getOrderStatusV2 } from '../../controllers/v2/orden.controller';
import { verifyApiKey } from '../../middlewares/v2/auth';

const router = Router();
router.get('/:id/estado', verifyApiKey, getOrderStatusV2);
export default router;
