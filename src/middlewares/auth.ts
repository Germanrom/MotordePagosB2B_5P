import { NextFunction, Request, Response } from 'express';
import prisma from '../config/prisma';
import { hashApiKey } from '../services/security/credentials';

export const verifyApiKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey) {
    res.status(401).json({ error: { code: 'api_key_required', message: 'X-API-Key is required' } });
    return;
  }

  try {
    let client = await prisma.client.findUnique({
      where: { api_key_hash: hashApiKey(apiKey) },
      select: { id: true, client_id: true, callback_url: true, subscription_callback_url: true, redirect_uri: true, webhook_secret: true, createdAt: true, updatedAt: true },
    });

    // Supports a rolling deployment; migrate_credentials.ts clears plaintext keys before rollout completes.
    if (!client) {
      const legacyClient = await prisma.client.findFirst({ where: { api_key: apiKey } });
      if (legacyClient) {
        const migrated = await prisma.client.updateMany({
          where: { id: legacyClient.id, api_key: apiKey, api_key_hash: null },
          data: { api_key_hash: hashApiKey(apiKey), api_key: null },
        });
        if (migrated.count === 1) {
          client = await prisma.client.findUnique({
            where: { id: legacyClient.id },
            select: { id: true, client_id: true, callback_url: true, subscription_callback_url: true, redirect_uri: true, webhook_secret: true, createdAt: true, updatedAt: true },
          });
        }
      }
    }

    if (!client) {
      res.status(401).json({ error: { code: 'invalid_api_key', message: 'API key is invalid' } });
      return;
    }
    req.client = client;
    next();
  } catch (error) {
    console.error('API key authentication failed:', error instanceof Error ? error.message : 'unknown error');
    res.status(500).json({ error: { code: 'internal_error', message: 'Unable to authenticate request' } });
  }
};
