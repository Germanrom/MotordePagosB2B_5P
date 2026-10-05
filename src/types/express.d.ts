import { Client } from '@prisma/client';

type TenantContext = Pick<Client, 'id' | 'client_id' | 'callback_url' | 'subscription_callback_url' | 'redirect_uri' | 'webhook_secret' | 'createdAt' | 'updatedAt'>;

declare global {
  namespace Express {
    interface Request {
      client?: TenantContext;
    }
  }
}
