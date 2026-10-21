-- StudentCase: disciplinary/incident records filed against a student.
-- Additive only: two new enum types plus one new table. No existing table altered.
CREATE TYPE "case_status" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

CREATE TYPE "case_severity" AS ENUM ('MINOR', 'MODERATE', 'SEVERE');

CREATE TABLE "student_cases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "filed_by_id" UUID NOT NULL,

    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "case_severity" NOT NULL,
    "status" "case_status" NOT NULL DEFAULT 'OPEN',
    "filed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_note" TEXT,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_cases_id_tenant_id_key" ON "student_cases"("id", "tenant_id");
CREATE INDEX "student_cases_tenant_id_student_id_idx" ON "student_cases"("tenant_id", "student_id");
CREATE INDEX "student_cases_tenant_id_status_idx" ON "student_cases"("tenant_id", "status");

ALTER TABLE "student_cases" ADD CONSTRAINT "student_cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_cases" ADD CONSTRAINT "student_cases_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_cases" ADD CONSTRAINT "student_cases_filed_by_id_fkey" FOREIGN KEY ("filed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;