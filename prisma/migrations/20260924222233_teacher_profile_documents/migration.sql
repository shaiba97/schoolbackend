-- CreateEnum
CREATE TYPE "teacher_document_type" AS ENUM ('PROFILE_IMAGE', 'ID_PROOF');

-- DropIndex
DROP INDEX "timetable_entries_tenant_id_section_subject_id_day_of_week__key";

-- AlterTable
ALTER TABLE "teachers" ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "gender" "gender";

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "document_type" "teacher_document_type" NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teacher_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_tenant_id_name_idx" ON "departments"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_id_tenant_id_key" ON "departments"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_code_key" ON "departments"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "teacher_documents_tenant_id_teacher_id_idx" ON "teacher_documents"("tenant_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_documents_teacher_id_document_type_key" ON "teacher_documents"("teacher_id", "document_type");

-- CreateIndex
CREATE INDEX "teachers_tenant_id_department_id_idx" ON "teachers"("tenant_id", "department_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_department_id_tenant_id_fkey" FOREIGN KEY ("department_id", "tenant_id") REFERENCES "departments"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_documents" ADD CONSTRAINT "teacher_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_documents" ADD CONSTRAINT "teacher_documents_teacher_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "timetable_entries_tenant_id_academic_year_id_term_id_section_su" RENAME TO "timetable_entries_tenant_id_academic_year_id_term_id_sectio_idx";
