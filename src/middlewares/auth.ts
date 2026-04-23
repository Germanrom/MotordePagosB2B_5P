import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';

export const verifyApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.header('X-API-Key');

    if (!apiKey) {
      return res.status(401).json({ error: 'API Key es requerida en el header X-API-Key' });
    }

    // Buscamos el cliente en la BD que coincida con la API Key
    const client = await prisma.client.findFirst({
      where: { api_key: apiKey },
    });

    if (!client) {
      return res.status(401).json({ error: 'API Key inválida o cliente no encontrado' });
    }

    // Adjuntamos el cliente al objeto request para usarlo en los controladores
    req.client = client;
    next();
  } catch (error) {
    console.error('Error verificando API Key:', error);
    res.status(500).json({ error: 'Error interno del servidor al verificar credenciales' });
  }
};
