-- Plan tiers and the subscription lock.
--
-- EXPAND phase only. Every statement is additive: a new enum type, new
-- columns, new indexes. Nothing is renamed, dropped, or retyped, so the
-- code that ran before this migration stays valid against the new schema
-- and the change can be undone by dropping exactly what this file adds.
--
-- The tier is a NEW enum type rather than a new member of an existing one.
-- PostgreSQL cannot use a value added by ALTER TYPE ... ADD VALUE inside the
-- transaction that added it, and the 20261020120000 migration already
-- demonstrated that failure mode. CREATE TYPE has no such restriction.
--
-- The tier catalogue itself (PRIMARY / INTERMEDIATE / ADVANCED / CUSTOM with
-- prices, portals, and feature limits) is business data, not schema, so it
-- ships as code (src/platform/platform-plan-tiers.ts) applied by
-- scripts/seed-platform-plans.mjs. That keeps prices and entitlements
-- editable without rewriting a migration.
--
-- DOWN (verified by hand on the test branch):
--   DROP INDEX "platform_plans_tier_idx";
--   DROP INDEX "tenant_licenses_status_expires_at_idx";
--   ALTER TABLE "tenants" DROP COLUMN "lock_reason", DROP COLUMN "locked_at";
--   ALTER TABLE "tenant_licenses" DROP COLUMN "termination_reason", DROP COLUMN "terminated_at";
--   ALTER TABLE "platform_plans"
--     DROP COLUMN "sort_order",
--     DROP COLUMN "duration_days",
--     DROP COLUMN "price_max",
--     DROP COLUMN "features",
--     DROP COLUMN "included_modules",
--     DROP COLUMN "target",
--     DROP COLUMN "tier";
--   DROP TYPE "plan_tier";

-- 1. Tier catalogue type.
CREATE TYPE "plan_tier" AS ENUM ('PRIMARY', 'INTERMEDIATE', 'ADVANCED', 'CUSTOM');

-- 2. Plan tier columns. Existing rows (LEGACY) keep a NULL tier, which is
--    what marks a self-onboarded school as predating the catalogue.
ALTER TABLE "platform_plans" ADD COLUMN "tier" "plan_tier";
ALTER TABLE "platform_plans" ADD COLUMN "target" VARCHAR(200);
ALTER TABLE "platform_plans" ADD COLUMN "included_modules" "portal_module"[] NOT NULL DEFAULT ARRAY[]::"portal_module"[];
ALTER TABLE "platform_plans" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "platform_plans" ADD COLUMN "price_max" DECIMAL(12,2);
ALTER TABLE "platform_plans" ADD COLUMN "duration_days" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "platform_plans" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- 3. License termination bookkeeping. A null terminated_at means the term
--    is still running; a value means the license was ended early.
ALTER TABLE "tenant_licenses" ADD COLUMN "terminated_at" TIMESTAMPTZ(6);
ALTER TABLE "tenant_licenses" ADD COLUMN "termination_reason" VARCHAR(40);

-- 4. Tenant lock. The tenant keeps its data and memberships; the lock is
--    what refuses every tenant-facing request.
ALTER TABLE "tenants" ADD COLUMN "locked_at" TIMESTAMPTZ(6);
ALTER TABLE "tenants" ADD COLUMN "lock_reason" VARCHAR(40);

-- 5. Indexes. The composite one drives the expiration sweep
--    ("active licenses that ended before now"); both tables are small, so a
--    plain CREATE INDEX is enough and CONCURRENTLY (which cannot run inside
--    a transaction) is unnecessary.
CREATE INDEX "platform_plans_tier_idx" ON "platform_plans"("tier");
CREATE INDEX "tenant_licenses_status_expires_at_idx" ON "tenant_licenses"("status", "expires_at");
