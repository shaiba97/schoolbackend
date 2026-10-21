-- DropForeignKey
ALTER TABLE "school_classes" DROP CONSTRAINT "school_classes_supervisor_teacher_id_tenant_id_fkey";

-- DropIndex
DROP INDEX "school_classes_tenant_id_name_key";

-- DropIndex
DROP INDEX "school_classes_tenant_id_sequence_no_idx";

-- DropIndex
DROP INDEX "school_classes_tenant_id_supervisor_teacher_id_idx";

-- AlterTable
ALTER TABLE "school_classes" DROP COLUMN "code",
DROP COLUMN "description",
DROP COLUMN "name",
DROP COLUMN "sequence_no",
DROP COLUMN "supervisor_teacher_id";

-- CreateIndex
CREATE UNIQUE INDEX "school_classes_tenant_id_class_name_key" ON "school_classes"("tenant_id", "class_name");
