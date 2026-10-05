-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "subscription_callback_url" TEXT;

-- CreateTable
CREATE TABLE "SaasSubscription" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "external_tenant_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "plan_version" TEXT NOT NULL,
    "terms_snapshot" JSONB NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "payer_email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CHECKOUT',
    "provider_preapproval_id" TEXT,
    "checkout_url" TEXT,
    "provider_status" TEXT,
    "first_paid_at" TIMESTAMP(3),
    "next_payment_at" TIMESTAMP(3),
    "paid_through" TIMESTAMP(3),
    "pending_plan_code" TEXT,
    "pending_plan_version" TEXT,
    "pending_terms_snapshot" JSONB,
    "pending_amount" DECIMAL(18,2),
    "cancel_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasBillingPeriod" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "provider_invoice_id" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasBillingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasPaymentAttempt" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "provider_status" TEXT NOT NULL,
    "status_detail" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasWebhookEvent" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "client_id" TEXT,
    "subscription_id" TEXT,
    "topic" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "last_error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "SaasWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasCallbackDelivery" (
    "id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "callback_url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "last_error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "SaasCallbackDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaasSubscription_provider_preapproval_id_key" ON "SaasSubscription"("provider_preapproval_id");

-- CreateIndex
CREATE INDEX "SaasSubscription_client_id_external_tenant_id_idx" ON "SaasSubscription"("client_id", "external_tenant_id");

-- One live checkout/subscription per app and external tenant; cancelled rows remain as history.
CREATE UNIQUE INDEX "SaasSubscription_one_open_per_tenant_key"
ON "SaasSubscription"("client_id", "external_tenant_id")
WHERE "status" IN ('CREATING', 'RECONCILIATION_REQUIRED', 'PENDING_CHECKOUT', 'AUTHORIZED', 'ACTIVE', 'PAST_DUE', 'CANCEL_PENDING');

-- CreateIndex
CREATE INDEX "SaasSubscription_status_next_payment_at_idx" ON "SaasSubscription"("status", "next_payment_at");

-- CreateIndex
CREATE UNIQUE INDEX "SaasSubscription_client_id_idempotency_key_key" ON "SaasSubscription"("client_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "SaasBillingPeriod_provider_invoice_id_key" ON "SaasBillingPeriod"("provider_invoice_id");

-- CreateIndex
CREATE INDEX "SaasBillingPeriod_subscription_id_period_end_idx" ON "SaasBillingPeriod"("subscription_id", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "SaasBillingPeriod_subscription_id_period_start_key" ON "SaasBillingPeriod"("subscription_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "SaasPaymentAttempt_provider_payment_id_key" ON "SaasPaymentAttempt"("provider_payment_id");

-- CreateIndex
CREATE INDEX "SaasPaymentAttempt_period_id_createdAt_idx" ON "SaasPaymentAttempt"("period_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaasWebhookEvent_request_id_key" ON "SaasWebhookEvent"("request_id");

-- CreateIndex
CREATE INDEX "SaasWebhookEvent_status_next_attempt_at_idx" ON "SaasWebhookEvent"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "SaasWebhookEvent_topic_resource_id_idx" ON "SaasWebhookEvent"("topic", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "SaasCallbackDelivery_event_key_key" ON "SaasCallbackDelivery"("event_key");

ALTER TABLE "SaasSubscription" ADD CONSTRAINT "SaasSubscription_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "SaasBillingPeriod" ADD CONSTRAINT "SaasBillingPeriod_valid_dates" CHECK ("period_end" > "period_start");
ALTER TABLE "SaasBillingPeriod" ADD CONSTRAINT "SaasBillingPeriod_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "SaasPaymentAttempt" ADD CONSTRAINT "SaasPaymentAttempt_amount_positive" CHECK ("amount" > 0);

-- CreateIndex
CREATE INDEX "SaasCallbackDelivery_status_next_attempt_at_idx" ON "SaasCallbackDelivery"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "SaasSubscription" ADD CONSTRAINT "SaasSubscription_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasBillingPeriod" ADD CONSTRAINT "SaasBillingPeriod_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "SaasSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasPaymentAttempt" ADD CONSTRAINT "SaasPaymentAttempt_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "SaasBillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasWebhookEvent" ADD CONSTRAINT "SaasWebhookEvent_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasWebhookEvent" ADD CONSTRAINT "SaasWebhookEvent_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "SaasSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasCallbackDelivery" ADD CONSTRAINT "SaasCallbackDelivery_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasCallbackDelivery" ADD CONSTRAINT "SaasCallbackDelivery_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "SaasSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
