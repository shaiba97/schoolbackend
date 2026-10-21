-- Guardian auto-numbers + 3rd-grade enrollment field. Purely additive;
-- existing rows keep NULLs (grandfathered by application validation).

DO $$ BEGIN
  CREATE TYPE "student_field" AS ENUM ('COMPUTER', 'BIOLOGY', 'ENGINEERING', 'MILITARY_SCIENCES', 'ISLAMIC_STUDIES');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "guardians" ADD COLUMN IF NOT EXISTS "guardian_number" VARCHAR(20);

-- Catches both the constraint-exists (42710) and the backing-index-exists
-- (42P07) variants so reruns stay clean on every branch.
DO $$ BEGIN
  ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenant_id_guardian_number_key" UNIQUE ("tenant_id", "guardian_number");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

ALTER TABLE "student_enrollments" ADD COLUMN IF NOT EXISTS "field" "student_field";
