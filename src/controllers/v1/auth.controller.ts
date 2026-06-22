import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import axios from 'axios';
import { createHmacSignature } from '../../utils/hmac';

export const getMpUrl = async (req: Request, res: Response): Promise<any> => {
  try {
    // ✨ MAGIA 1: Ahora aceptamos opcionalmente un vendor_id para no pisar sucursales
    const { client_id, vendor_id } = req.query;

    if (!client_id || typeof client_id !== 'string') {
      return res.status(400).json({ error: 'client_id es requerido por Query' });
    }

    const client = req.client!;
    if (client.client_id !== client_id) {
      return res.status(403).json({ error: 'El client_id no coincide con la API Key' });
    }

    const MP_CLIENT_ID = process.env.MP_CLIENT_ID;
    if (!MP_CLIENT_ID) {
      return res.status(500).json({ error: 'Falta configurar MP_CLIENT_ID en el motor' });
    }

    // Usamos EXACTAMENTE la URL que configuraste en MP
    const redirectUri = 'https://motor-de-pagos.onrender.com/auth/callback';
    
    // Armamos un "State Compuesto". Ejemplo: "CLI-123___4" (Cliente 123, Vendedor 4)
    // Si no mandan vendor_id, le ponemos "NEW" para que cree uno nuevo.
    const safeVendorId = vendor_id ? String(vendor_id) : 'NEW';
    const compositeState = `${client.client_id}___${safeVendorId}`;

    const authUrl = `https://auth.mercadopago.com/authorization?client_id=${MP_CLIENT_ID}&response_type=code&platform_id=mp&state=${compositeState}&redirect_uri=${redirectUri}`;

    return res.json({ auth_url: authUrl });
  } catch (error) {
    console.error('Error en getMpUrl:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const mpCallback = async (req: Request, res: Response): Promise<any> => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
      return res.status(400).json({ error: 'code y state son requeridos' });
    }

    // ✨ MAGIA 2: Desarmamos el state para saber quién es quién
    const [clientId, vendorIdStr] = state.split('___');

    const client = await prisma.client.findUnique({
      where: { client_id: clientId },
    });

    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // 1. Intercambiar code por tokens con MP
    const url = 'https://api.mercadopago.com/oauth/token';
    const redirectUri = 'https://motor-de-pagos.onrender.com/auth/callback'; // Exacta
    
    const mpData: Record<string, string> = {
      client_secret: process.env.MP_CLIENT_SECRET || '',
      client_id: process.env.MP_CLIENT_ID || '',
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
    };

    let tokens;
    try {
      const mpResponse = await axios.post(url, new URLSearchParams(mpData).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      tokens = mpResponse.data;
    } catch (mpError: any) {
      console.error('Error obteniendo tokens de MP:', mpError.response?.data || mpError.message);
      return res.status(500).json({ error: 'Fallo al intercambiar el código con Mercado Pago' });
    }

    if (!tokens.access_token || !tokens.user_id) {
      return res.status(500).json({ error: 'Respuesta de MP inválida' });
    }

    // ✨ MAGIA 3: Evitamos el crash de BBDD usando el ID real de Mercado Pago
    const mpEmailSeguro = `vendedor_${tokens.user_id}@mercadopago.com`;

    // ==========================================
    // 2. CREAR O ACTUALIZAR VENDOR EN LA BD
    // ==========================================
    let vendor;
    
    if (vendorIdStr !== 'NEW') {
      vendor = await prisma.vendor.findFirst({
        where: { id: Number(vendorIdStr), client_id: client.id }
      });
    }

    if (vendor) {
      vendor = await prisma.vendor.update({
        where: { id: vendor.id },
        data: {
          mp_access_token: tokens.access_token,
          mp_refresh_token: tokens.refresh_token,
          mp_email: mpEmailSeguro,
        }
      });
    } else {
      vendor = await prisma.vendor.create({
        data: {
          mp_access_token: tokens.access_token,
          mp_refresh_token: tokens.refresh_token,
          client_id: client.id,
          mp_email: mpEmailSeguro,
        }
      });
    }

    // ==========================================
    // 3. Notificar al sistema cliente (Webhook HMAC)
    // ==========================================
    const payload = {
      client_id: client.client_id,
      vendor_id: vendor.id,
      mp_email: mpEmailSeguro,
      estado: 'success',
      error_msg: null,
    };

    const signature = createHmacSignature(payload, client.webhook_secret);

    try {
      await axios.post(client.callback_url, payload, {
        headers: {
          'x-motor-signature': signature,
          'Content-Type': 'application/json',
        },
      });
    } catch (webhookError: any) {
      console.error(`Error notificando al cliente:`, webhookError.message);
    }

    // 4. Redirigir al cliente
    // Si la pizzería no mandó una URI de éxito, mostramos una pantalla por defecto
    if (!client.redirect_uri) {
        return res.status(200).send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #166534;">✅ Vinculación Exitosa</h1>
                <p>El vendedor <strong>#${vendor.id}</strong> ya puede empezar a cobrar.</p>
                <p style="color: gray;">Podés cerrar esta pestaña.</p>
            </div>
        `);
    }

    return res.redirect(client.redirect_uri);
  } catch (error) {
    console.error('Error en mpCallback:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};