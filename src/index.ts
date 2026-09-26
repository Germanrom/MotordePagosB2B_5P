import 'dotenv/config';
import app from './app';
import { startCallbackOutboxWorker } from './services/payments/callback-outbox.service';
import { startWebhookRetryWorker } from './controllers/v2/webhook.controller';

const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log(`Payment engine listening on port ${port}`);
  startCallbackOutboxWorker();
  startWebhookRetryWorker();
});
