import 'dotenv/config';
import { createHash } from 'node:crypto';
import prisma from '../src/config/prisma';
import { encryptConfiguredSecret } from '../src/services/security/secret-crypto';

async function main() {
  if (!process.env.TOKEN_ENCRYPTION_KEY) throw new Error('TOKEN_ENCRYPTION_KEY is required');
  const clients = await prisma.client.findMany({ select: { id: true, api_key: true, webhook_secret: true } });
  const vendors = await prisma.vendor.findMany({ select: { id: true, mp_access_token: true, mp_refresh_token: true } });
  const keyedClients = clients.filter((client) => client.api_key).map((client) => ({ ...client, hash: createHash('sha256').update(client.api_key!).digest('hex') }));
  const duplicateHashes = new Set<string>();
  const seen = new Set<string>();
  for (const client of keyedClients) {
    if (seen.has(client.hash)) duplicateHashes.add(client.hash);
    seen.add(client.hash);
  }
  if (duplicateHashes.size) throw new Error('Duplicate API keys exist across tenants; resolve them before migrating credentials');

  await prisma.$transaction([
    ...clients.map(({ id, api_key, webhook_secret }) => prisma.client.update({
      where: { id },
      data: {
        ...(api_key ? { api_key_hash: createHash('sha256').update(api_key).digest('hex'), api_key: null } : {}),
        webhook_secret: webhook_secret.startsWith('enc:v1:') ? webhook_secret : encryptConfiguredSecret(webhook_secret),
      },
    })),
    ...vendors.map((vendor) => prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        mp_access_token: vendor.mp_access_token.startsWith('enc:v1:') ? vendor.mp_access_token : encryptConfiguredSecret(vendor.mp_access_token),
        mp_refresh_token: vendor.mp_refresh_token
          ? vendor.mp_refresh_token.startsWith('enc:v1:') ? vendor.mp_refresh_token : encryptConfiguredSecret(vendor.mp_refresh_token)
          : null,
      },
    })),
  ]);

  console.log(`Migrated credential material for ${clients.length} tenants and ${vendors.length} MP accounts.`);
}

main().catch((error) => {
  console.error('Credential migration failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
