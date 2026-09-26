const DEFAULT_API_BASE_URL = 'https://api.mercadopago.com';

export const mercadoPagoApiUrl = (path: string): string => {
  const baseUrl = process.env.MP_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  return new URL(path.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`).toString();
};
