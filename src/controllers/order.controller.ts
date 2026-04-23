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

export const createOrder = async (req: Request, res: Response): Promise<void> => {
    try {
        const { vendor_id, monto, concepto, external_id } = req.body;

        if (!vendor_id) {
            res.status(400).json({ error: "El vendor_id es obligatorio" });
            return;
        }

        // 1. BUSCAMOS AL VENDEDOR (Con red de seguridad)
        // 👇 Descomentá y ajustá esto según cómo tu asistente armó la BBDD
        
        const vendedor = await prisma.vendor.findUnique({ where: { id: vendor_id } });
        
        if (!vendedor) {
            res.status(404).json({ error: "Vendedor no encontrado en la base de datos" });
            return;
        }
        

        // 2. MAGIA DE ARQUITECTURA: Prioridad de Tokens
        // En producción, usa el token de la BBDD. Si estamos probando (y el de BBDD no existe), usa el del .env.
        // const tokenParaCobrar = vendedor?.mp_access_token || process.env.MP_ACCESS_TOKEN;
        
        // MOCK TEMPORAL MIENTRAS CONECTÁS LA BBDD:
        const tokenParaCobrar = process.env.MP_ACCESS_TOKEN;

        if (!tokenParaCobrar) {
            res.status(500).json({ error: "No hay token configurado para este vendedor" });
            return;
        }

        // 3. Inicializar Mercado Pago con el token del vendedor específico
        const client = new MercadoPagoConfig({ accessToken: tokenParaCobrar });
        const preference = new Preference(client);

        const bodyPreferencia = {
            items: [{
                id: "item-123",
                title: concepto,
                quantity: 1,
                unit_price: Number(monto),
                currency_id: "ARS"
            }],
            external_reference: external_id,
            // Aca iría tu URL real de webhook cuando esté en Render
            notification_url: "https://motor-de-pagos-api.onrender.com/webhook"
        };

        const respuestaMP = await preference.create({ body: bodyPreferencia });
        
        res.status(200).json({
            id_orden: "orden_db_123", // Luego lo cambias por la orden guardada en BBDD
            checkout_url: respuestaMP.init_point,
            estado: "pending"
        });

    } catch (error) {
        console.error("❌ Error de MP:", error);
        res.status(500).json({ error: "Explotó la conexión con Mercado Pago" });
    }
};
//export const createOrder = async (req: Request, res: Response) => {
//  try {
//    // 1. Validar el cuerpo del request usando Zod
//    const result = createOrderSchema.safeParse(req.body);
//    if (!result.success) {
//      return res.status(422).json({ error: 'Datos inválidos', details: result.error.issues });
//    }
//    const { vendor_id, monto, moneda, concepto, external_id } = result.data;
    
    // 2. El cliente viene del middleware de autenticación
//    const client = req.client!;

    // 3. Verificar que el vendor exista y pertenezca a este cliente
 //   const vendor = await prisma.vendor.findFirst({
 //     where: { id: vendor_id, client_id: client.id },
 //   });


    // comentamos de forma temporal la validación del vendor para permitir pruebas sin necesidad de crear vendors
    //if (!vendor) {
    //  return res.status(404).json({ error: 'Vendor no encontrado o no pertenece a este cliente' });
    //}

    // 4. Crear la orden en nuestra base de datos
    //const newOrder = await prisma.order.create({
      //data: {
        //external_id,
        //monto,
        //moneda,
        //concepto,
        //vendor_id: vendor.id,
        //client_id: client.id,
      //},
    //});

    // 5. Crear la preferencia en Mercado Pago usando el access_token del Vendor
    //const mpClient = new MercadoPagoConfig({ accessToken: vendor.mp_access_token });
    //const preference = new Preference(mpClient);

    //const notificationUrl = `https://motor-de-pagos-api.onrender.com/webhook?vendedor_id=${vendor.id}`;

    //const prefResponse = await preference.create({
      //body: {
        //items: [
          //{
            //id: external_id,
            //title: concepto,
            //quantity: 1,
            //unit_price: monto,
            //currency_id: moneda,
          //},
        //],
        //external_reference: newOrder.id,
        //notification_url: notificationUrl,
        //auto_return: 'approved',
      //},
    //});

    // 6. Actualizar la orden con el checkout URL (opcional, pero buena práctica)
    //if (prefResponse.init_point) {
      //await prisma.order.update({
        //where: { id: newOrder.id },
        //data: { checkout_url: prefResponse.init_point }
      //});
    //}

    // 7. Retornar la respuesta según la documentación
    //res.status(200).json({
      //id_orden: newOrder.id,
      //checkout_url: prefResponse.init_point,
      //estado: newOrder.estado,
      //created_at: newOrder.createdAt,
    //});
  //} catch (error: any) {
    //console.error('Error en createOrder:', error.message || error);
    //res.status(500).json({ error: 'Error interno del servidor al crear la orden' });
  //}
//};

export const getOrderStatus = async (req: Request, res: Response) => {
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
