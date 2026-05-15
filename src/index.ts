import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// 1. IMPORTAMOS LAS RUTAS DE LA V1 (La versión estable)
import authRoutesV1 from './routes/v1/auth.routes';
import orderRoutesV1 from './routes/v1/order.routes';
import webhookRoutesV1 from './routes/v1/webhook.routes';

// 2. IMPORTAMOS LAS RUTAS DE LA V2 (La nueva generación)
import authRoutesV2 from './routes/v2/auth.routes';
import pagosRoutesV2 from './routes/v2/pago.routes';

// Si ya duplicaste order.routes y webhook.routes a la v2, descomentá estas líneas:
// import orderRoutesV2 from './routes/v2/order.routes';
// import webhookRoutesV2 from './routes/v2/webhook.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// --- MIDDLEWARES GLOBALES ---

// CORS configurado para que el frontend HTML de prueba pueda conectarse sin bloqueos
app.use(cors({
  origin: '*', // En desarrollo permitimos que cualquiera se conecte
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'] 
}));

// El traductor: Le enseña a Express a leer los JSON del Body
app.use(express.json());

// Rayos X: Imprime en consola cada petición que llega al servidor
app.use((req, res, next) => {
  console.log(`[🔍 DEBUG] Petición entrante: ${req.method} ${req.url}`);
  next();
});

// --- RUTAS DE SALUD Y PRUEBA ---
app.get('/', (req, res) => {
  res.json({ 
    status: "ok", 
    mensaje: "🚀 Motor de Pagos B2B operando al 100%",
    version: "Dual (V1 y V2)"
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Motor de Pagos (Node.js) is running!' });
});

// --- 🛡️ VERSIÓN 1 (Intacta para clientes actuales) ---
app.use('/v1/auth', authRoutesV1);
app.use('/v1/ordenes', orderRoutesV1);
app.use('/v1/webhook', webhookRoutesV1);

// --- 🚀 VERSIÓN 2 (La nueva generación con Bricks) ---
app.use('/v2/auth', authRoutesV2);
app.use('/v2/pagos', pagosRoutesV2); // Acá atiende el endpoint /v2/pagos/brick

// Si los descomentaste arriba, descomentalos acá también:
//app.use('/v2/ordenes', orderRoutesV2);
//app.use('/v2/webhook', webhookRoutesV2);

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
  console.log(`🛡️  V1 disponible en /v1`);
  console.log(`🧱 V2 disponible en /v2 (Bricks listos)`);
});