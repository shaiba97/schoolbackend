-- AlterTable
ALTER TABLE "school_classes" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "supervisor_teacher_id" UUID;

-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "department_id" UUID;

-- AlterTable
ALTER TABLE "timetable_entries" ADD COLUMN     "class_id" UUID NOT NULL,
ADD COLUMN     "is_break" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subject_id" UUID,
ADD COLUMN     "teacher_id" UUID,
ALTER COLUMN "section_subject_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sport_timetable_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "sport" VARCHAR(150) NOT NULL,
    "day" "day_of_week" NOT NULL,
    "slot_no" INTEGER NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sport_timetable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sport_timetable_entries_tenant_id_class_id_idx" ON "sport_timetable_entries"("tenant_id", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_timetable_entries_tenant_id_class_id_day_slot_no_key" ON "sport_timetable_entries"("tenant_id", "class_id", "day", "slot_no");

-- CreateIndex
CREATE UNIQUE INDEX "sport_timetable_entries_id_tenant_id_key" ON "sport_timetable_entries"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "school_classes_tenant_id_supervisor_teacher_id_idx" ON "school_classes"("tenant_id", "supervisor_teacher_id");

-- CreateIndex
CREATE INDEX "subjects_tenant_id_department_id_idx" ON "subjects"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "timetable_entries_tenant_id_class_id_idx" ON "timetable_entries"("tenant_id", "class_id");

-- CreateIndex
CREATE INDEX "timetable_entries_tenant_id_subject_id_idx" ON "timetable_entries"("tenant_id", "subject_id");

-- CreateIndex
CREATE INDEX "timetable_entries_tenant_id_teacher_id_idx" ON "timetable_entries"("tenant_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_tenant_id_class_id_day_of_week_period_no_key" ON "timetable_entries"("tenant_id", "class_id", "day_of_week", "period_no");

-- AddForeignKey
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_supervisor_teacher_id_tenant_id_fkey" FOREIGN KEY ("supervisor_teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_department_id_tenant_id_fkey" FOREIGN KEY ("department_id", "tenant_id") REFERENCES "departments"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "school_classes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_subject_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "tenant_id") REFERENCES "subjects"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_timetable_entries" ADD CONSTRAINT "sport_timetable_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_timetable_entries" ADD CONSTRAINT "sport_timetable_entries_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "school_classes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
