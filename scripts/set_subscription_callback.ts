import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const [clientId, rawUrl] = process.argv.slice(2);
if (!clientId || !rawUrl || process.argv.length !== 4) {
  throw new Error('Usage: npm run tenant:set-subscription-callback -- <client-id> <https-callback-url>');
}
const url = new URL(rawUrl);
if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
  throw new Error('Subscription callback must be an HTTPS URL without credentials or fragment');
}

const db = new PrismaClient();
db.client.update({ where: { client_id: clientId }, data: { subscription_callback_url: url.toString() }, select: { client_id: true, subscription_callback_url: true } })
  .then((client) => console.log(JSON.stringify(client)))
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
