-- Platform financials: currencies, expenses, and manual payments.
--
-- EXPAND phase only. Every statement is additive: three new enums, three
-- new tables, one new index. Nothing is renamed, dropped, or retyped, so the
-- code that ran before this migration stays valid against the new schema.
--
-- The three new enum types are separate from the tenant finance enums
-- (payment_method, payment_status, expense_status) on purpose: the platform
-- books money against licenses in many currencies, which is a different
-- domain from a school's fee schedule.
--
-- DOWN (verified by hand on the test branch):
--   DROP INDEX "platform_payments_currency_idx";
--   DROP TABLE "platform_payments";
--   DROP TABLE "platform_expenses";
--   DROP TABLE "platform_currencies";
--   DROP TYPE "platform_payment_type";
--   DROP TYPE "platform_payment_method";
--   DROP TYPE "platform_expense_category";

-- 1. Enums.
CREATE TYPE "platform_expense_category" AS ENUM ('INFRASTRUCTURE', 'MARKETING', 'LEGAL', 'SUPPORT', 'OTHER');
CREATE TYPE "platform_payment_method" AS ENUM ('BANK_TRANSFER', 'CHEQUE', 'CASH', 'BANK_API');
CREATE TYPE "platform_payment_type" AS ENUM ('MANUAL_TRANSFER', 'CASH_DEPOSIT', 'BANK_API_PENDING');

-- 2. Currency table with the USD base rate. The ISO code is the primary
--    key, so this table carries no surrogate id.
CREATE TABLE "platform_currencies" (
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "country_code" CHAR(2),
    "symbol" VARCHAR(8),
    "rate_to_usd" DECIMAL(18,6) NOT NULL,
    "auto_sync" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "platform_currencies_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "platform_currencies_is_active_idx" ON "platform_currencies"("is_active");

-- 3. Platform expenses. A null country_code means the cost is allocated
--    globally rather than to a single market.
CREATE TABLE "platform_expenses" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "category" "platform_expense_category" NOT NULL,
    "country_code" CHAR(2),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" VARCHAR(400),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_expenses_category_idx" ON "platform_expenses"("category");
CREATE INDEX "platform_expenses_country_code_idx" ON "platform_expenses"("country_code");
CREATE INDEX "platform_expenses_paid_at_idx" ON "platform_expenses"("paid_at");

-- 4. Manual payments logged against a school's license.
CREATE TABLE "platform_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "license_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "platform_payment_method" NOT NULL,
    "type" "platform_payment_type" NOT NULL DEFAULT 'MANUAL_TRANSFER',
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "reference" VARCHAR(80),
    "notes" VARCHAR(400),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_payments_tenant_id_paid_at_idx" ON "platform_payments"("tenant_id", "paid_at");
CREATE INDEX "platform_payments_currency_idx" ON "platform_payments"("currency");

-- 5. Foreign keys.
ALTER TABLE "platform_expenses" ADD CONSTRAINT "platform_expenses_recorded_by_id_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL;
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "tenant_licenses"("id") ON DELETE SET NULL;
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_recorded_by_id_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL;
