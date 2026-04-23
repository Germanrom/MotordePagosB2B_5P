import crypto from 'crypto';

export const createHmacSignature = (payload: any, secret: string): string => {
  const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(bodyString);
  return hmac.digest('hex');
};

export const verifyHmacSignature = (payload: any, secret: string, signature: string): boolean => {
  const expectedSignature = createHmacSignature(payload, secret);
  // Usamos timingSafeEqual para evitar ataques de timing, pero requiere Buffers
  return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
};
