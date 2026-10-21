-- NOTE: the tenant_status enum values TRIAL and PENDING were already applied
-- to the database by a previous failed run (Prisma applies ALTER TYPE ADD
-- VALUE outside the migration transaction), so they are intentionally NOT
-- re-issued here.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "weekend_days" TEXT[] NOT NULL DEFAULT ARRAY['FRI','SAT']::text[];

-- CreateEnum
CREATE TYPE "platform_admin_role" AS ENUM ('SUPER_ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "platform_admin_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "billing_model" AS ENUM ('LIFETIME', 'ANNUAL');

-- CreateEnum
CREATE TYPE "license_status" AS ENUM ('ACTIVE', 'DUE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "invoice_kind" AS ENUM ('LICENSE', 'ONBOARDING', 'HOSTING', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('PAID', 'DUE', 'VOID');

-- CreateEnum
CREATE TYPE "portal_module" AS ENUM ('ADMIN', 'ACADEMIC', 'FINANCIAL', 'TEACHER', 'GUARDIAN', 'STUDENT', 'TRANSPORT');

-- CreateEnum
CREATE TYPE "announcement_severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "platform_admin_role" NOT NULL DEFAULT 'SUPER_ADMIN',
    "status" "platform_admin_status" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "billing_model" "billing_model" NOT NULL,
    "region" VARCHAR(40),
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_licenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "license_status" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "seats" INTEGER,
    "notes" VARCHAR(400),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "license_id" UUID,
    "number" VARCHAR(40) NOT NULL,
    "kind" "invoice_kind" NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'DUE',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),
    "notes" VARCHAR(400),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "module" "portal_module" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_feature_flags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60),
    "entity_id" UUID,
    "tenant_id" UUID,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_announcements" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "announcement_severity" NOT NULL DEFAULT 'INFO',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "platform_admin_id" UUID NOT NULL,
    "code_hash" VARCHAR(80) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "redeemed_at" TIMESTAMPTZ(6),
    "redeemed_ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_backups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "file_name" VARCHAR(200) NOT NULL,
    "format" VARCHAR(10) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_user_id_key" ON "platform_admins"("user_id");

-- CreateIndex
CREATE INDEX "platform_admins_status_idx" ON "platform_admins"("status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_plans_code_key" ON "platform_plans"("code");

-- CreateIndex
CREATE INDEX "platform_plans_is_active_idx" ON "platform_plans"("is_active");

-- CreateIndex
CREATE INDEX "tenant_licenses_tenant_id_status_idx" ON "tenant_licenses"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_licenses_id_tenant_id_key" ON "tenant_licenses"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_number_key" ON "platform_invoices"("number");

-- CreateIndex
CREATE INDEX "platform_invoices_tenant_id_status_idx" ON "platform_invoices"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_id_tenant_id_key" ON "platform_invoices"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_modules_tenant_id_module_key" ON "tenant_modules"("tenant_id", "module");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_modules_id_tenant_id_key" ON "tenant_modules"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_feature_flags_tenant_id_key_key" ON "tenant_feature_flags"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_feature_flags_id_tenant_id_key" ON "tenant_feature_flags"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_tenant_id_idx" ON "platform_audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_actor_id_idx" ON "platform_audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "platform_announcements_is_active_published_at_idx" ON "platform_announcements"("is_active", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "impersonation_sessions_code_hash_key" ON "impersonation_sessions"("code_hash");

-- CreateIndex
CREATE INDEX "impersonation_sessions_platform_admin_id_created_at_idx" ON "impersonation_sessions"("platform_admin_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_backups_tenant_id_created_at_idx" ON "platform_backups"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_licenses" ADD CONSTRAINT "tenant_licenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_licenses" ADD CONSTRAINT "tenant_licenses_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_license_id_tenant_id_fkey" FOREIGN KEY ("license_id", "tenant_id") REFERENCES "tenant_licenses"("id", "tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_announcements" ADD CONSTRAINT "platform_announcements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_platform_admin_id_fkey" FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_backups" ADD CONSTRAINT "platform_backups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_backups" ADD CONSTRAINT "platform_backups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: LEGACY lifetime plan for existing self-onboarded tenants
INSERT INTO "platform_plans" ("id", "code", "name", "billing_model", "price", "currency", "is_active", "created_at", "updated_at")
VALUES ('00000000-0000-4000-8000-000000000001', 'LEGACY', 'Legacy self-onboarded', 'LIFETIME', 0, 'USD', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Backfill: an ACTIVE license pointing at the LEGACY plan for every tenant
INSERT INTO "tenant_licenses" ("id", "tenant_id", "plan_id", "status", "started_at", "created_at", "updated_at")
SELECT gen_random_uuid(), t."id", p."id", 'ACTIVE', t."created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
JOIN "platform_plans" p ON p."code" = 'LEGACY'
WHERE NOT EXISTS (SELECT 1 FROM "tenant_licenses" l WHERE l."tenant_id" = t."id");

-- Backfill: all seven portal modules enabled for existing tenants
INSERT INTO "tenant_modules" ("id", "tenant_id", "module", "enabled", "updated_at")
SELECT gen_random_uuid(), t."id", m."module"::portal_module, true, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES ('ADMIN'), ('ACADEMIC'), ('FINANCIAL'), ('TEACHER'), ('GUARDIAN'), ('STUDENT'), ('TRANSPORT')) AS m("module")
ON CONFLICT ("tenant_id", "module") DO NOTHING;

-- Backfill: sensible baseline feature flags, derived from each tenant's country
INSERT INTO "tenant_feature_flags" ("id", "tenant_id", "key", "enabled", "updated_at")
SELECT gen_random_uuid(), t."id", v."key", COALESCE(v."enabled", false), CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN LATERAL (VALUES
    ('portal.transport.tracking', true),
    ('notifications.whatsapp', false),
    ('compliance.vat', t."country_code" IN ('SA', 'AE', 'QA', 'KW', 'BH', 'OM')),
    ('payments.bankak', t."country_code" = 'SD'),
    ('payments.mada_knet', t."country_code" IN ('SA', 'KW'))
) AS v("key", "enabled")
ON CONFLICT ("tenant_id", "key") DO NOTHING;
