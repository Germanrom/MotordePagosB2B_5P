import crypto from 'crypto';

export const createHmacSignature = (payload: any, secret: string): string => {
  const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(bodyString);
  return hmac.digest('hex');
};

export const verifyHmacSignature = (payload: any, secret: string, signature: string): boolean => {
  // 1. Calculamos la firma esperada
  const expectedSignature = createHmacSignature(payload, secret);
  
  // 2. Convertimos ambas firmas a Buffers
  const expectedBuffer = Buffer.from(expectedSignature);
  // Por precaución, si por algún motivo la firma llega vacía, armamos un buffer vacío
  const signatureBuffer = Buffer.from(signature || ''); 

  // 3. ¡LA DEFENSA CONTRA EL CRASH! Validamos las longitudes primero
  if (expectedBuffer.length !== signatureBuffer.length) {
    console.error('ALERTA: Rechazo de webhook por longitud de firma incorrecta.');
    return false; // Rechazamos silenciosamente sin tirar el servidor
  }

  // 4. Si miden lo mismo, comparamos de forma criptográficamente segura
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};