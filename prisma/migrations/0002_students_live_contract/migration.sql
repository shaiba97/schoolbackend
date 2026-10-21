ALTER TYPE "student_status" ADD VALUE 'PENDING_ADMISSION';

CREATE TYPE "education_level" AS ENUM ('SECONDARY', 'INTERMEDIATE');
CREATE TYPE "school_class_grade" AS ENUM ('FIRST', 'SECOND', 'THIRD', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH');
CREATE TYPE "class_track" AS ENUM ('ART', 'SCIENCE');
CREATE TYPE "student_document_type" AS ENUM ('PROFILE_IMAGE', 'NATIONAL_NUMBER', 'NATIONAL_CARD', 'PASSPORT', 'TRANSFER_RESULT');

ALTER TABLE "school_classes"
  ADD COLUMN "class_name" VARCHAR(100),
  ADD COLUMN "education_level" "education_level",
  ADD COLUMN "grade" "school_class_grade",
  ADD COLUMN "track" "class_track";

UPDATE "school_classes"
SET "class_name" = "name",
    "education_level" = 'SECONDARY',
    "grade" = 'FIRST'
WHERE "class_name" IS NULL;

ALTER TABLE "school_classes"
  ALTER COLUMN "class_name" SET NOT NULL,
  ALTER COLUMN "education_level" SET NOT NULL,
  ALTER COLUMN "grade" SET NOT NULL;

ALTER TABLE "students"
  RENAME COLUMN "admission_number" TO "role_number";

ALTER TABLE "students"
  ADD COLUMN "mother_fullname" VARCHAR(100),
  ADD COLUMN "father_fullname" VARCHAR(100),
  ADD COLUMN "education_level" "education_level",
  ADD COLUMN "grade" INTEGER,
  ADD COLUMN "is_transferred" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "former_school_name" VARCHAR(160);

ALTER TABLE "students"
  ALTER COLUMN "role_number" SET DATA TYPE VARCHAR(100);

DROP INDEX IF EXISTS "students_tenant_id_admission_number_key";
CREATE UNIQUE INDEX "students_tenant_id_role_number_key" ON "students"("tenant_id", "role_number");
CREATE INDEX "students_tenant_id_education_level_grade_idx" ON "students"("tenant_id", "education_level", "grade");

ALTER TABLE "students"
  ALTER COLUMN "status" SET DEFAULT 'PENDING_ADMISSION';

CREATE TABLE "student_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "document_type" "student_document_type" NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_documents_student_id_document_type_key" ON "student_documents"("student_id", "document_type");
CREATE INDEX "student_documents_tenant_id_student_id_idx" ON "student_documents"("tenant_id", "student_id");

ALTER TABLE "student_documents"
  ADD CONSTRAINT "student_documents_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "student_documents"
  ADD CONSTRAINT "student_documents_student_id_tenant_id_fkey"
  FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
