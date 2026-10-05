import { Router } from 'express';
import { verifyApiKey } from '../../middlewares/v2/auth';
import { getSubscription, startSubscriptionCheckout } from '../../controllers/v2/subscription.controller';

const router = Router();
router.post('/', verifyApiKey, startSubscriptionCheckout);
router.get('/:id', verifyApiKey, getSubscription);
export default router;
