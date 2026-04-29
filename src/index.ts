import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.routes';
import orderRoutes from './routes/order.routes';
import webhookRoutes from './routes/webhook.routes';

dotenv.config();

const app = express();
// 2. AGREGÁS ESTE BLOQUE EXACTO DE CORS
app.use(cors({
  origin: '*', // En desarrollo permitimos que cualquiera se conecte
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'] // ¡Clave para que no bloquee tu llave!
}));

app.use('/auth',authRoutes);
// 🪄 EL TRADUCTOR: Le enseña a Express a leer los JSON del Body
app.use(express.json());
// La puerta de entrada (Prueba de vida)
app.get('/', (req, res) => {
  res.json({ 
    status: "ok", 
    mensaje: "🚀 Motor de Pagos B2B operando al 100%",
    version: "1.0"
  });
});
const PORT = process.env.PORT || 10000;


app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Motor de Pagos V2 (Node.js) is running!' });
});

// Rutas de la API
app.use('/auth', authRoutes);
app.use('/ordenes', orderRoutes);
app.use('/webhook', webhookRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
