import { Request, Response } from 'express';
import { z } from 'zod';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import prisma from '../config/prisma';

const createOrderSchema = z.object({
  vendor_id: z.number(),
  monto: z.number().positive(),
  moneda: z.string().default('ARS'),
  concepto: z.string(),
  external_id: z.string(),
});

export const createOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    // 1. Validar el cuerpo del request usando Zod
    const result = createOrderSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({ error: 'Datos inválidos', details: result.error.issues });
    }
    const { vendor_id, monto, moneda, concepto, external_id } = result.data;
    
    // 2. El cliente viene del middleware de autenticación (tu API Key)
    const client = req.client!;

    // 3. Verificar que el vendor exista y pertenezca a este cliente
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendor_id, client_id: client.id },
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor no encontrado o no pertenece a este cliente' });
    }

    // 4. Crear la orden en nuestra base de datos
    const newOrder = await prisma.order.create({
      data: {
        external_id,
        monto,
        moneda,
        concepto,
        vendor_id: vendor.id,
        client_id: client.id,
      },
    });

    // 5. Crear la preferencia en MP usando el access_token del Vendor real
    const mpClient = new MercadoPagoConfig({ accessToken: vendor.mp_access_token });
    const preference = new Preference(mpClient);

    const urlNgrok = "https://motor-de-pagos.onrender.com"; 
    const notificationUrl = `${urlNgrok}/webhook?vendedor_id=${vendor.id}`;

    const prefResponse = await preference.create({
      body: {
        items: [
          {
            id: external_id,
            title: concepto,
            quantity: 1,
            unit_price: monto,
            currency_id: moneda,
          },
        ],
        external_reference: newOrder.id,
        notification_url: notificationUrl,
        back_urls: {
            success: "https://www.google.com",
            failure: "https://www.google.com",
            pending: "https://www.google.com"
        },  
        auto_return: 'approved',
      },
    });

    // 6. Actualizar la orden con el checkout URL (Usamos init_point para evitar bucles de Sandbox)
    if (prefResponse.init_point) {
      await prisma.order.update({
        where: { id: newOrder.id },
        data: { checkout_url: prefResponse.init_point }
      });
    }

    // 7. Retornar la respuesta al cliente
    return res.status(200).json({
      id_orden: newOrder.id,
      checkout_url: prefResponse.init_point,
      estado: newOrder.estado,
      created_at: newOrder.createdAt,
    });

  } catch (error: any) {
    console.error('Error en createOrder:', error.message || error);
    return res.status(500).json({ error: 'Error interno del servidor al crear la orden' });
  }
};

export const getOrderStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const client = req.client!;

    const order = await prisma.order.findFirst({
      where: { id: String(id), client_id: client.id },
    });

    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    return res.status(200).json({
      id_orden: order.id,
      external_id: order.external_id,
      estado: order.estado,
      mp_payment_id: order.mp_payment_id,
      updated_at: order.updatedAt,
    });
  } catch (error) {
    console.error('Error en getOrderStatus:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};