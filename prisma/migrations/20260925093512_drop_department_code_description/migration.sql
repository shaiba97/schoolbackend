-- DropIndex
DROP INDEX "departments_tenant_id_code_key";

-- AlterTable
ALTER TABLE "departments" DROP COLUMN "code",
DROP COLUMN "description";

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_name_key" ON "departments"("tenant_id", "name");
