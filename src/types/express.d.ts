import { Client } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      client?: Client;
    }
  }
}
