import { Request, Response } from 'express';
import crypto from 'crypto';
// Ajustá esta ruta de importación según dónde tengas tu cliente de Prisma
import prisma from '../../config/prisma'; 

export const procesarPagoBrick = async (req: Request, res: Response) => {
  try {
    // 1. Tipamos los datos que nos envía el frontend de tu cliente (Pizzasys)
    const { vendor_id, formData, external_reference } = req.body;

    // 2. Buscamos al Vendedor en Supabase
    const vendor = await prisma.vendor.findUnique({
      where: { id: Number(vendor_id) }
    });

    if (!vendor || !vendor.mp_access_token) {
      return res.status(404).json({ error: "Vendedor no encontrado o sin token válido" });
    }

    // 3. Enviamos el pago a Mercado Pago (API v1/payments)
    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vendor.mp_access_token}`, // El token del local
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID() // Evita cobrar doble si hay lag
      },
      body: JSON.stringify({
        ...formData,
        external_reference: external_reference, // Ideal para vincular el ID del pedido
      })
    });

    const paymentResult = await mpResponse.json();

    // 4. Devolvemos el resultado al frontend de Pizzasys para que muestre el ticket
    res.status(mpResponse.status).json(paymentResult);

  } catch (error) {
    console.error("[Error Pago Brick]:", error);
    res.status(500).json({ error: "Error procesando el pago transparente" });
  }
};