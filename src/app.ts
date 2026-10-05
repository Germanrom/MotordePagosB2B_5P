import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import authRoutesV1 from './routes/v1/auth.routes';
import orderRoutesV1 from './routes/v1/order.routes';
import webhookRoutesV1 from './routes/v1/webhook.routes';
import authRoutesV2 from './routes/v2/auth.routes';
import pagosRoutesV2 from './routes/v2/pago.routes';
import orderRoutesV2 from './routes/v2/orden.routes';
import webhookRoutesV2 from './routes/v2/webhook.routes';

export const app = express();

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Idempotency-Key', 'Authorization'],
}));
app.use(express.json({ limit: '64kb' }));

app.get('/', (_req, res) => {
  res.json({ status: 'ok', mensaje: 'Motor de Pagos B2B operando', version: 'V1 links de pago; V2 Payment Brick' });
});
app.get('/health', (_req, res) => res.json({ status: 'ok', message: 'Motor de Pagos (Node.js) is running!' }));

app.use('/v1/auth', authRoutesV1);
app.use('/auth', authRoutesV1);
app.use('/v1/ordenes', orderRoutesV1);
app.use('/v1/webhook', webhookRoutesV1);

app.use('/v2/auth', authRoutesV2);
app.use('/v2/pagos', pagosRoutesV2);
app.use('/v2/ordenes', orderRoutesV2);
app.use('/v2/webhook', webhookRoutesV2);

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(error); return; }
  const parserError = error as { type?: string };
  if (parserError.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'JSON request body cannot exceed 64 KB' } });
    return;
  }
  if (parserError.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'invalid_json', message: 'Request body must contain valid JSON' } });
    return;
  }
  console.error('Unhandled HTTP request error:', error instanceof Error ? error.message : 'unknown');
  res.status(500).json({ error: { code: 'internal_error', message: 'Request could not be processed' } });
});

export default app;
