import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { encryptConfiguredSecret } from '../src/services/security/secret-crypto';

const prisma = new PrismaClient({});

async function main() {
  const apiKeyMaestra = process.env.MI_API_KEY_MAESTRA;
  const webhookSecret = process.env.SEED_WEBHOOK_SECRET;
  const callbackUrl = process.env.SEED_CALLBACK_URL;
  const redirectUri = process.env.SEED_REDIRECT_URI;
  if (!apiKeyMaestra || !webhookSecret || !callbackUrl || !redirectUri) throw new Error('Set MI_API_KEY_MAESTRA, SEED_WEBHOOK_SECRET, SEED_CALLBACK_URL, and SEED_REDIRECT_URI');
  const apiKeyHash = createHash('sha256').update(apiKeyMaestra).digest('hex');

  const newClient = await prisma.client.upsert({
    where: { client_id: 'ENUAR' },
    create: {
      client_id: 'ENUAR',
      api_key_hash: apiKeyHash,
      callback_url: callbackUrl,
      redirect_uri: redirectUri,
      webhook_secret: encryptConfiguredSecret(webhookSecret),
    },
    update: { api_key_hash: apiKeyHash, api_key: null, callback_url: callbackUrl, redirect_uri: redirectUri, webhook_secret: encryptConfiguredSecret(webhookSecret) },
  });

  console.log(`Seeded tenant ${newClient.client_id} (id ${newClient.id}); credentials were not printed.`);
}

main()
  .catch((e) => {
    console.error('❌ Error insertando cliente:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
