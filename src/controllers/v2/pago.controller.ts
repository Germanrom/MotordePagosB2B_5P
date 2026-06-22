import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../config/prisma'; 

export const procesarPagoBrick = async (req: Request, res: Response): Promise<any> => {
  try {
    // 1. Extraemos TODO el body. El frontend manda vendor_id y los datos de MP al mismo nivel
    const { vendor_id, ...paymentData } = req.body;

    // 2. Buscamos al Cliente y al Vendedor (Seguridad B2B)
    const client = req.client!; // Viene del middleware de la API Key

    const vendor = await prisma.vendor.findFirst({
      where: { id: Number(vendor_id), client_id: client.id }
    });

    if (!vendor || !vendor.mp_access_token) {
      return res.status(404).json({ error: "Vendedor no encontrado o sin token válido" });
    }

    // 3. ✨ PRIMERO: Creamos la orden en nuestra base de datos (Para el Dashboard)
    const external_id = "ORD-BRICK-" + Date.now();
    
    const nuevaOrden = await prisma.order.create({
      data: {
        external_id: external_id,
        monto: Number(paymentData.transaction_amount),
        moneda: 'ARS',
        concepto: 'Cobro Inteligente V2 (Brick)',
        estado: 'PENDING',
        vendor_id: vendor.id,
        client_id: client.id
      }
    });

    // 4. Enviamos el pago a Mercado Pago (API v1/payments)
    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vendor.mp_access_token}`, 
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID() // Evita cobrar doble
      },
      body: JSON.stringify({
        ...paymentData,
        external_reference: nuevaOrden.external_id, // Vinculamos la orden
        // Le avisamos al Webhook de tu backend para que actualice la base de datos automáticamente
        notification_url: `https://motordepagosb2b-5p.onrender.com/v1/webhook?vendedor_id=${vendor.id}`
      })
    });

    const paymentResult = await mpResponse.json();

    // 5. Actualizamos la orden con la respuesta inmediata de Mercado Pago
    if (paymentResult.id) {
      const estadoFinal = paymentResult.status === 'approved' ? 'APPROVED' : 'PENDING';
      
      await prisma.order.update({
        where: { id: nuevaOrden.id },
        data: {
          estado: estadoFinal,
          mp_payment_id: String(paymentResult.id)
        }
      });
    }

    // 6. Devolvemos el resultado al frontend (Index.html) para que dibuje el éxito
    return res.status(mpResponse.status).json(paymentResult);

  } catch (error) {
    console.error("[Error Pago Brick]:", error);
    return res.status(500).json({ error: "Error interno procesando el pago Brick" });
  }
};