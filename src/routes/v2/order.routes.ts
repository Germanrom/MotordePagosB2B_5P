/*
import { Router } from 'express';
import { createOrder, getOrderStatus } from '../../controllers/v2/order.controller';
import { verifyApiKey } from '../../middlewares/v2/auth';

const router = Router();

// Todas las rutas de órdenes requieren API Key
router.use(verifyApiKey);

// POST /ordenes - Crear nueva orden
router.post('/', createOrder);

// GET /ordenes/:id/estado - Consultar estado de una orden
router.get('/:id/estado', getOrderStatus);

export default router;
