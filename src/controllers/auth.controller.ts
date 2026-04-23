import { Request, Response } from 'express';
import prisma from '../config/prisma';
import axios from 'axios';
import { createHmacSignature } from '../utils/hmac';

export const getMpUrl = async (req: Request, res: Response) => {
  try {
    const { client_id } = req.query;

    if (!client_id || typeof client_id !== 'string') {
      return res.status(400).json({ error: 'client_id es requerido por Query' });
    }

    // El middleware ya valida el API Key y nos da el req.client
    const client = req.client!;
    if (client.client_id !== client_id) {
      return res.status(403).json({ error: 'El client_id no coincide con la API Key' });
    }

    const MP_CLIENT_ID = process.env.MP_CLIENT_ID;
    if (!MP_CLIENT_ID) {
      return res.status(500).json({ error: 'Falta configurar MP_CLIENT_ID en el motor' });
    }

    // Construimos la URL OAuth de MP.
    // Usamos el 'state' para pasar el client_id y saber de quién es el callback luego.
    const redirectUri = 'https://motor-de-pagos-api.onrender.com/auth/callback'; // O la URL de tu motor
    const authUrl = `https://auth.mercadopago.com/authorization?client_id=${MP_CLIENT_ID}&response_type=code&platform_id=mp&state=${client.client_id}&redirect_uri=${redirectUri}`;

    res.json({ auth_url: authUrl });
  } catch (error) {
    console.error('Error en getMpUrl:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const mpCallback = async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
      return res.status(400).json({ error: 'code y state son requeridos' });
    }

    const clientId = state;

    const client = await prisma.client.findUnique({
      where: { client_id: clientId },
    });

    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // 1. Intercambiar code por tokens con MP
    const url = 'https://api.mercadopago.com/oauth/token';
    const redirectUri = 'https://motor-de-pagos-api.onrender.com/auth/callback'; // Debe coincidir con la de getMpUrl
    
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

    if (!tokens.access_token) {
      return res.status(500).json({ error: 'Respuesta de MP no contiene access_token' });
    }

    // 2. Crear Vendor en la BD
    const newVendor = await prisma.vendor.create({
      data: {
        mp_access_token: tokens.access_token,
        mp_refresh_token: tokens.refresh_token,
        client_id: client.id,
        // (Opcional: podriamos hacer un GET a MP para sacar el email de este access_token y guardarlo en mp_email)
      }
    });

    // 3. Notificar al sistema cliente (POST server-to-server)
    const payload = {
      client_id: client.client_id,
      vendor_id: newVendor.id,
      mp_email: 'cuenta_vinculada@mercadopago.com', // Placeholder por ahora
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
      console.error(`Error notificando al cliente (${client.callback_url}):`, webhookError.message);
      // Aunque el webhook falle, la vinculación fue exitosa, el cliente tendrá que proveer un fallback para consultar vendors.
    }

    // 4. Redirigir al cliente
    res.redirect(client.redirect_uri);
  } catch (error) {
    console.error('Error en mpCallback:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
