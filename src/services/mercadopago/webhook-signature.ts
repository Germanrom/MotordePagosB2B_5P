import { createHmac, timingSafeEqual } from 'node:crypto';

export const validateMpWebhookSignature = (
  xSignature: string | undefined,
  xRequestId: string | undefined,
  dataId: string | undefined,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean => {
  if (!xSignature || !xRequestId || !dataId || !secret) return false;

  const parts = Object.fromEntries(xSignature.split(',').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? [part.trim(), ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  const timestamp = Number(parts.ts);
  const signature = parts.v1;
  if (!Number.isSafeInteger(timestamp) || !signature || Math.abs(nowSeconds - timestamp) > 86_400) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${parts.ts};`;
  const expected = Buffer.from(createHmac('sha256', secret).update(manifest).digest('hex'), 'hex');
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(expected, received);
};
