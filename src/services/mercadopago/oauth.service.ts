import { createHash, randomBytes } from 'node:crypto';
import prisma from '../../config/prisma';

export const hashOAuthState = (state: string): string => createHash('sha256').update(state).digest('hex');

export const createOAuthState = async (clientId: string, now = new Date()) => {
  const state = randomBytes(32).toString('base64url');
  await prisma.oAuthState.create({
    data: { client_id: clientId, state_hash: hashOAuthState(state), expires_at: new Date(now.getTime() + 10 * 60 * 1_000) },
  });
  return state;
};

export const consumeOAuthState = async (state: string, now = new Date()) => {
  const stateHash = hashOAuthState(state);
  const result = await prisma.oAuthState.updateMany({
    where: { state_hash: stateHash, consumed_at: null, expires_at: { gt: now } },
    data: { consumed_at: now },
  });
  if (result.count !== 1) return null;
  return prisma.oAuthState.findUnique({ where: { state_hash: stateHash }, include: { client: true } });
};

export const getActiveMercadoPagoAccount = async (clientId: string) => {
  const account = await prisma.vendor.findFirst({
    where: { client_id: clientId, v2_active: true },
    select: { id: true, mp_user_id: true, mp_public_key: true, mp_expires_at: true },
  });
  if (!account) return { connected: false as const, public_key: null, expires_at: null };
  return {
    connected: true as const,
    public_key: account.mp_public_key,
    expires_at: account.mp_expires_at,
  };
};
