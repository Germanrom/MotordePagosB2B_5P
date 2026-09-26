ALTER TABLE "Client"
  ALTER COLUMN "api_key" DROP NOT NULL,
  ADD COLUMN "api_key_hash" TEXT;

ALTER TABLE "Vendor"
  ADD COLUMN "mp_user_id" TEXT,
  ADD COLUMN "mp_public_key" TEXT,
  ADD COLUMN "mp_expires_at" TIMESTAMP(3),
  ADD COLUMN "v2_active" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Client_api_key_hash_key" ON "Client"("api_key_hash");
CREATE INDEX "Vendor_mp_user_id_idx" ON "Vendor"("mp_user_id");
CREATE UNIQUE INDEX "Vendor_id_client_id_key" ON "Vendor"("id", "client_id");
CREATE INDEX "Vendor_client_id_idx" ON "Vendor"("client_id");

ALTER TABLE "Order"
  ALTER COLUMN "monto" TYPE DECIMAL(18,2) USING ROUND("monto"::numeric, 2),
  ADD COLUMN "last_payment_id" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Order" AS orders
    JOIN "Vendor" AS vendors ON vendors."id" = orders."vendor_id"
    WHERE vendors."client_id" <> orders."client_id"
  ) THEN
    RAISE EXCEPTION 'Orders reference a Vendor owned by a different tenant. Resolve the mismatches before applying this migration; rows will not be reassigned automatically.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Order"
    GROUP BY "client_id", "external_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Order external_id values exist per tenant. Run scripts/report_migration_conflicts.ts and resolve them before applying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "Order_client_id_external_id_key"
  ON "Order"("client_id", "external_id");
CREATE UNIQUE INDEX "Order_id_client_id_vendor_id_key"
  ON "Order"("id", "client_id", "vendor_id");
CREATE INDEX "Order_client_id_createdAt_idx" ON "Order"("client_id", "createdAt");
CREATE INDEX "Order_vendor_id_createdAt_idx" ON "Order"("vendor_id", "createdAt");

ALTER TABLE "Order" DROP CONSTRAINT "Order_vendor_id_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_vendor_client_fkey"
  FOREIGN KEY ("vendor_id", "client_id") REFERENCES "Vendor"("id", "client_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OAuthState" (
  "id" TEXT NOT NULL,
  "state_hash" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthState_state_hash_key" ON "OAuthState"("state_hash");
CREATE INDEX "OAuthState_expires_at_idx" ON "OAuthState"("expires_at");
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "vendor_id" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "provider_idempotency_key" TEXT NOT NULL,
  "provider_payment_id" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'PENDING',
  "status_detail" TEXT,
  "monto" DECIMAL(18,2) NOT NULL,
  "moneda" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_provider_idempotency_key_key" ON "Payment"("provider_idempotency_key");
CREATE UNIQUE INDEX "Payment_provider_payment_id_key" ON "Payment"("provider_payment_id");
CREATE UNIQUE INDEX "Payment_client_id_idempotency_key_key" ON "Payment"("client_id", "idempotency_key");
CREATE UNIQUE INDEX "Payment_id_client_id_key" ON "Payment"("id", "client_id");
CREATE INDEX "Payment_order_id_createdAt_idx" ON "Payment"("order_id", "createdAt");
CREATE INDEX "Payment_client_id_createdAt_idx" ON "Payment"("client_id", "createdAt");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_order_client_vendor_fkey"
  FOREIGN KEY ("order_id", "client_id", "vendor_id") REFERENCES "Order"("id", "client_id", "vendor_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_vendor_client_fkey"
  FOREIGN KEY ("vendor_id", "client_id") REFERENCES "Vendor"("id", "client_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "vendor_id" INTEGER NOT NULL,
  "payment_id" TEXT,
  "resource_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_until" TIMESTAMP(3),
  "last_error" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookEvent_request_id_key" ON "WebhookEvent"("request_id");
CREATE INDEX "WebhookEvent_estado_next_attempt_at_idx" ON "WebhookEvent"("estado", "next_attempt_at");
CREATE INDEX "WebhookEvent_client_id_received_at_idx" ON "WebhookEvent"("client_id", "received_at");
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_vendor_client_fkey"
  FOREIGN KEY ("vendor_id", "client_id") REFERENCES "Vendor"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_payment_client_fkey"
  FOREIGN KEY ("payment_id", "client_id") REFERENCES "Payment"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CallbackDelivery" (
  "id" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "callback_url" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "signature" TEXT NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_until" TIMESTAMP(3),
  "last_error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered_at" TIMESTAMP(3),
  CONSTRAINT "CallbackDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CallbackDelivery_event_key_key" ON "CallbackDelivery"("event_key");
CREATE INDEX "CallbackDelivery_estado_next_attempt_at_idx" ON "CallbackDelivery"("estado", "next_attempt_at");
ALTER TABLE "CallbackDelivery" ADD CONSTRAINT "CallbackDelivery_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CallbackDelivery" ADD CONSTRAINT "CallbackDelivery_payment_client_fkey"
  FOREIGN KEY ("payment_id", "client_id") REFERENCES "Payment"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve old vendors for V1. Only exactly-one vendor tenants are candidates for V2.
WITH single_vendor_tenants AS (
  SELECT "client_id", MIN("id") AS "vendor_id"
  FROM "Vendor"
  GROUP BY "client_id"
  HAVING COUNT(*) = 1 AND BOOL_AND(BTRIM("mp_access_token") <> '')
)
UPDATE "Vendor" AS vendor SET "v2_active" = true
FROM single_vendor_tenants AS eligible
WHERE vendor."client_id" = eligible."client_id" AND vendor."id" = eligible."vendor_id";

CREATE UNIQUE INDEX "Vendor_one_v2_active_per_client_key"
  ON "Vendor"("client_id") WHERE "v2_active" = true;
