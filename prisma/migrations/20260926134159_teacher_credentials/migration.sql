-- CreateEnum
CREATE TYPE "teacher_document_source" AS ENUM ('ACADEMIC_AFFAIRS', 'TEACHER');

-- CreateTable
CREATE TABLE "teacher_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "source" "teacher_document_source" NOT NULL DEFAULT 'ACADEMIC_AFFAIRS',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teacher_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teacher_credentials_tenant_id_teacher_id_idx" ON "teacher_credentials"("tenant_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_credentials_id_tenant_id_key" ON "teacher_credentials"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_credentials_tenant_id_teacher_id_title_key" ON "teacher_credentials"("tenant_id", "teacher_id", "title");

-- AddForeignKey
ALTER TABLE "teacher_credentials" ADD CONSTRAINT "teacher_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_credentials" ADD CONSTRAINT "teacher_credentials_teacher_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing single-slot ID proofs over to named credentials so the
-- teacher's documents stay visible in the new ID-card view. Idempotent via
-- the (tenant, teacher, title) unique index: a re-run collides and is skipped.
INSERT INTO "teacher_credentials" (
    "id", "tenant_id", "teacher_id", "title", "object_key", "original_name",
    "content_type", "size", "source", "created_at", "updated_at"
)
SELECT
    gen_random_uuid(),
    d."tenant_id",
    d."teacher_id",
    'ID proof',
    d."object_key",
    d."original_name",
    d."content_type",
    d."size",
    'ACADEMIC_AFFAIRS',
    d."created_at",
    d."updated_at"
FROM "teacher_documents" AS d
WHERE d."document_type" = 'ID_PROOF'
ON CONFLICT ("tenant_id", "teacher_id", "title") DO NOTHING;
