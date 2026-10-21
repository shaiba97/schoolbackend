-- DropIndex
DROP INDEX "subjects_tenant_id_code_idx";

-- AlterTable
ALTER TABLE "subjects" DROP COLUMN "code",
DROP COLUMN "description";
