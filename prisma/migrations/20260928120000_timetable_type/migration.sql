-- AlterTable
ALTER TABLE "timetable_entries" ADD COLUMN "timetable_type" VARCHAR(20) NOT NULL DEFAULT 'REGULAR';
ALTER TABLE "timetable_entries" ADD COLUMN "exam_name" VARCHAR(150) NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX IF EXISTS "timetable_entries_tenant_id_class_id_day_of_week_period_no_key";

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_tenant_id_class_id_timetable_type_exam_name_day_of_week_period_no_key" ON "timetable_entries"("tenant_id", "class_id", "timetable_type", "exam_name", "day_of_week", "period_no");
