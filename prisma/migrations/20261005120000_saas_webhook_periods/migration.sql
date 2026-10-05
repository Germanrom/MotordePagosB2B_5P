-- A rejected first charge can have an invoice before the next paid-through date is known.
ALTER TABLE "SaasBillingPeriod" ALTER COLUMN "period_end" DROP NOT NULL;
