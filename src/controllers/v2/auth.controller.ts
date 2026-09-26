import { Request, Response } from 'express';
import axios from 'axios';
import prisma from '../../config/prisma';
import { createOAuthState, consumeOAuthState, getActiveMercadoPagoAccount } from '../../services/mercadopago/oauth.service';
import { encryptConfiguredSecret, decryptConfiguredSecret } from '../../services/security/secret-crypto';
import { hashCallbackSignature } from '../../services/security/credentials';
import { mercadoPagoApiUrl } from '../../services/mercadopago/api-url';

const redirectUri = () => {
  const base = process.env.APP_BASE_URL;
  if (!base) throw new Error('APP_BASE_URL is required');
  return new URL('/v2/auth/callback', base).toString();
};

export const getMpUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const mpClientId = process.env.MP_CLIENT_ID;
    if (!mpClientId) { res.status(503).json({ error: 'Mercado Pago OAuth is not configured' }); return; }
    const state = await createOAuthState(req.client!.id);
    const url = new URL('https://auth.mercadopago.com/authorization');
    url.search = new URLSearchParams({ client_id: mpClientId, response_type: 'code', platform_id: 'mp', state, redirect_uri: redirectUri() }).toString();
    res.json({ auth_url: url.toString() });
  } catch (error) {
    console.error('Could not start Mercado Pago OAuth:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: 'Could not start Mercado Pago authorization' });
  }
};

export const getMpAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getActiveMercadoPagoAccount(req.client!.id));
  } catch (error) {
    console.error('Could not read active Mercado Pago account:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: 'internal_error', message: 'Could not read Mercado Pago account status' });
  }
};

export const mpCallback = async (req: Request, res: Response): Promise<void> => {
  const { code, state, error: oauthError } = req.query;
  if (oauthError) { res.status(400).send('Mercado Pago authorization was not completed.'); return; }
  if (typeof code !== 'string' || typeof state !== 'string') { res.status(400).send('Invalid OAuth callback.'); return; }
  try {
    const oauth = await consumeOAuthState(state);
    if (!oauth) { res.status(400).send('OAuth state is invalid, expired, or already used.'); return; }
    const clientId = process.env.MP_CLIENT_ID;
    const clientSecret = process.env.MP_CLIENT_SECRET;
    if (!clientId || !clientSecret) { res.status(503).send('Mercado Pago OAuth is not configured.'); return; }
    const { data: tokens } = await axios.post(mercadoPagoApiUrl('/oauth/token'), new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri() }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 12_000 });
    if (!tokens.access_token || !tokens.user_id) { res.status(502).send('Mercado Pago returned incomplete credentials.'); return; }
    const mpUserId = String(tokens.user_id);
    const linkedElsewhere = await prisma.vendor.findFirst({ where: { mp_user_id: mpUserId, client_id: { not: oauth.client_id } } });
    if (linkedElsewhere) { res.status(409).send('This Mercado Pago account is linked to another tenant.'); return; }
    const vendor = await prisma.$transaction(async (tx) => {
      const existing = await tx.vendor.findFirst({ where: { client_id: oauth.client_id, mp_user_id: mpUserId } });
      await tx.vendor.updateMany({ where: { client_id: oauth.client_id, v2_active: true }, data: { v2_active: false } });
      const values = {
        mp_access_token: encryptConfiguredSecret(tokens.access_token),
        mp_refresh_token: tokens.refresh_token ? encryptConfiguredSecret(tokens.refresh_token) : null,
        mp_email: `vendedor_${mpUserId}@mercadopago.com`,
        mp_user_id: mpUserId,
        mp_public_key: tokens.public_key ?? null,
        mp_expires_at: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null,
        v2_active: true,
      };
      return existing
        ? tx.vendor.update({ where: { id: existing.id }, data: values })
        : tx.vendor.create({ data: { ...values, client_id: oauth.client_id } });
    });
    const payload = { client_id: oauth.client.client_id, vendor_id: vendor.id, mp_email: vendor.mp_email, estado: 'success', error_msg: null };
    try {
      await axios.post(oauth.client.callback_url, payload, { timeout: 8_000, headers: { 'x-motor-signature': hashCallbackSignature(payload, decryptConfiguredSecret(oauth.client.webhook_secret)), 'Content-Type': 'application/json' } });
    } catch (error) { console.error('OAuth callback notification deferred/unavailable:', error instanceof Error ? error.message : 'unknown'); }
    res.redirect(oauth.client.redirect_uri);
  } catch (error) {
    console.error('Mercado Pago OAuth callback failed:', error instanceof Error ? error.message : 'unknown');
    res.status(502).send('Could not complete Mercado Pago authorization.');
  }
};
