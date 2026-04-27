import { Request, Response } from 'express';
import prisma from '../config/prisma';
import axios from 'axios';
import crypto from 'crypto';
import { createHmacSignature } from '../utils/hmac';

// Función para validar la firma HMAC enviada por Mercado Pago en Producción
const validateMpSignature = (xSignature: string, xRequestId: string, dataId: string): boolean => {
  const secret = process.env.MP_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[ERROR Webhook] No se encontró MP_WEBHOOK_SECRET en las variables de entorno');
    return false;
  }
  
  if (!xSignature || !xRequestId) {
    console.error('[ERROR Webhook] Faltan headers de firma de Mercado Pago (x-signature o x-request-id)');
    return false;
  }

  try {
    const parts = xSignature.split(',').reduce((acc, curr) => {
      const [key, value] = curr.split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    const { ts, v1 } = parts;

    if (!ts || !v1) {
      console.error('[ERROR Webhook] Formato de x-signature inválido');
      return false;
    }

    // Re-armamos el manifest tal como lo pide la documentación oficial v2
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(manifest);
    const expectedSignature = hmac.digest('hex');

    const isValid = crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(v1));

    if (!isValid) {
      console.error(`[ERROR Webhook] Firma inválida. Posible intento de fraude o Secret incorrecto.`);
      return false; // EN PRODUCCIÓN ESTO DEBE SER FALSE
    }

    return true;
  } catch (error) {
    console.error('[ERROR Webhook] Fallo validando firma de MP:', error);
    return false;
  }
};

export const handleWebhook = async (req: Request, res: Response): Promise<any> => {
  try {
    const { vendedor_id } = req.query;
    const xSignature = req.headers['x-signature'] as string;
    const xRequestId = req.headers['x-request-id'] as string;
    const body = req.body;

    console.log("--- WEBHOOK RECIBIDO ---");
    console.log(`Vendedor ID (Query): ${vendedor_id}`);

    if (!vendedor_id) {
      console.error("[Webhook] Falta vendedor_id en la URL");
      return res.status(200).send("OK"); // Respondemos 200 para que MP no reintente
    }

    // 1. Verificamos si es un evento de pago
    const isPayment = body.type === 'payment' || body.action?.startsWith('payment.');

    if (isPayment) {
      const paymentId = body.data?.id || body.id;

      if (!paymentId) {
        console.error("[Webhook] Falta el ID de pago en el body");
        return res.status(200).send("OK");
      }

      // 2. Validar la firma de seguridad (HMAC)
      if (!validateMpSignature(xSignature, xRequestId, String(paymentId))) {
        console.error(`[ALERTA Webhook] Firma rechazada para el pago ${paymentId}`);
        return res.status(403).send("Firma de seguridad inválida");
      }

      // 3. Buscamos al vendedor para tener su token
      const vendor = await prisma.vendor.findUnique({
        where: { id: Number(vendedor_id) },
        include: { client: true },
      });

      if (!vendor) {
        console.error(`[Webhook] Vendor ${vendedor_id} no encontrado en DB`);
        return res.status(200).send("OK");
      }

      // 4. Consultamos el estado REAL a Mercado Pago
      const url = `https://api.mercadopago.com/v1/payments/${paymentId}`;
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${vendor.mp_access_token}` },
      });

      const mpResponse = response.data;
      console.log(`[Webhook] Estado del pago ${paymentId} en MP: ${mpResponse.status}`);

      // 5. Si está aprobado, actualizamos la base de datos
      if (mpResponse.status === 'approved') {
        const orderId = mpResponse.external_reference;

        const order = await prisma.order.findUnique({
          where: { id: orderId }
        });

        // Solo procesamos si la orden existe y aún está PENDING
        if (order && order.estado === 'PENDING') {
          await prisma.order.update({
            where: { id: orderId },
            data: {
              estado: 'APPROVED',
              mp_payment_id: String(paymentId)
            },
          });

          console.log(`✅ ORDEN ${orderId} ACTUALIZADA A APPROVED`);

          // 6. Notificar al sistema del cliente (ej. CentroEnuar)
          const payload = {
            id_orden: order.id,
            external_id: order.external_id,
            estado: 'approved',
            mp_payment_id: String(paymentId),
            monto: order.monto,
            moneda: order.moneda,
          };
          
          const signature = createHmacSignature(payload, vendor.client.webhook_secret);

          try {
            await axios.post(vendor.client.callback_url, payload, {
              headers: {
                'x-motor-signature': signature,
                'Content-Type': 'application/json'
              }
            });
            console.log(`[Webhook] Notificación exitosa al cliente: ${vendor.client.client_id}`);
          } catch (e: any) {
            console.error(`[Webhook] Error avisando al cliente ${vendor.client.client_id}:`, e.message);
          }
        } else {
           console.log(`[Webhook] Orden ${orderId} no encontrada o ya procesada.`);
        }
      }
    }

    return res.status(200).send("OK");
  } catch (error: any) {
    console.error('[ERROR CRITICO Webhook]:', error.message || error);
    return res.status(200).send("OK"); // Siempre 200 para que MP no reintente eternamente
  }
};