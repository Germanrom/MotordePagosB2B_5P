import { NextFunction, Request, Response } from 'express';

// RFC 9745 Deprecation date: 2026-09-26T00:00:00Z.
const V1_DEPRECATION_DATE = '@1790380800';

export const markV1Deprecated = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Deprecation', V1_DEPRECATION_DATE);
  res.setHeader('X-API-Deprecation-Info', 'API V1 está obsoleta; migrar a los endpoints V2. V1 sigue disponible temporalmente.');
  next();
};
