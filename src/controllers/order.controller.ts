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

    // 4. Crear la orden en nuestra base de datos (¡Vital para el Webhook!)
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

    // 👇 ACÁ VA TU MAGIA DE NGROK
    // Reemplazá esta URL por la que te dio tu terminal al correr "npx ngrok http 8000"
    //const urlNgrok = "https://starry-provided-likeness.ngrok-free.dev"; 
    const urlNgrok = "https://motor-de-pagos.onrender.com"; //URL DE PRODUCCION
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

        // 👇 ACÁ ESTÁ LA SOLUCIÓN: Le decimos adónde mandar al usuario al terminar
        back_urls: {
            success: "https://www.google.com", // Éxito
            failure: "https://www.google.com", // Fallo
            pending: "https://www.google.com"  // Pendiente
        },  

        auto_return: 'approved',
      },
    });

// 6. Actualizar la orden con el checkout URL (USAMOS INIT_POINT REAL)
    if (prefResponse.init_point) {
      await prisma.order.update({
        where: { id: newOrder.id },
        data: { checkout_url: prefResponse.init_point }
      });
    }

    // 7. Retornar la respuesta
    res.status(200).json({
      id_orden: newOrder.id,
      checkout_url: prefResponse.init_point, // JUBILAMOS EL SANDBOX
      estado: newOrder.estado,
      created_at: newOrder.createdAt,
    });

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

    res.status(200).json({
      id_orden: order.id,
      external_id: order.external_id,
      estado: order.estado,
      mp_payment_id: order.mp_payment_id,
      updated_at: order.updatedAt,
    });
  } catch (error) {
    console.error('Error en getOrderStatus:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};