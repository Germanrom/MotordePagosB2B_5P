import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashApiKey } from '../src/services/security/credentials';
import { encryptConfiguredSecret } from '../src/services/security/secret-crypto';

const prisma = new PrismaClient();

const readOptions = (args: string[]) => {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid argument near ${key ?? '(end)'}`);
    options.set(key, value);
  }
  const clientId = options.get('--client-id');
  const callbackUrl = options.get('--callback-url');
  const redirectUri = options.get('--redirect-uri');
  if (options.size !== 3 || !clientId || !callbackUrl || !redirectUri) {
    throw new Error('Usage: npm run tenant:create -- --client-id ENUAR --callback-url https://tenant.example/callback --redirect-uri https://tenant.example/settings');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(clientId)) throw new Error('--client-id must be 2-64 letters, numbers, underscores, or hyphens');
  for (const [name, value] of [['--callback-url', callbackUrl], ['--redirect-uri', redirectUri]]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error(`${name} must use HTTPS outside localhost`);
  }
  return { clientId, callbackUrl, redirectUri };
};

async function main() {
  const { clientId, callbackUrl, redirectUri } = readOptions(process.argv.slice(2));
  const apiKey = randomBytes(32).toString('base64url');
  const webhookSecret = randomBytes(32).toString('hex');
  const tenant = await prisma.client.create({
    data: {
      client_id: clientId,
      api_key_hash: hashApiKey(apiKey),
      callback_url: callbackUrl,
      redirect_uri: redirectUri,
      webhook_secret: encryptConfiguredSecret(webhookSecret),
    },
    select: { id: true, client_id: true },
  });
  console.log(JSON.stringify({
    tenant_id: tenant.id,
    client_id: tenant.client_id,
    api_key: apiKey,
    webhook_secret: webhookSecret,
    warning: 'Save api_key and webhook_secret in your secret manager now. They cannot be retrieved from the database.',
  }, null, 2));
}

main().catch((error) => {
  console.error('Tenant provisioning failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
