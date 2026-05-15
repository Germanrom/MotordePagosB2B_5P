import { Router } from 'express';
import { procesarPagoBrick } from '../../controllers/v2/pago.controller';
// Reutilizamos el middleware de tu V1 porque la seguridad es la misma
import { verifyApiKey } from '../../middlewares/v2/auth'; 

const router = Router();

// POST /api/v2/pagos/brick - Protegido por API Key de tu Motor
router.post('/brick', verifyApiKey, procesarPagoBrick);

export default router;