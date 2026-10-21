-- CreateEnum
CREATE TYPE "hall_type" AS ENUM ('PHYSICAL', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "recheck_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum (additive only: existing exam rows keep their meaning)
ALTER TYPE "exam_status" ADD VALUE 'MARKS_OPEN';
ALTER TYPE "exam_status" ADD VALUE 'MODERATION';
ALTER TYPE "exam_status" ADD VALUE 'PROCESSED';
ALTER TYPE "exam_status" ADD VALUE 'CLOSED';

-- AlterEnum (additive only)
ALTER TYPE "result_status" ADD VALUE 'SUBMITTED';
ALTER TYPE "result_status" ADD VALUE 'MODERATED';
ALTER TYPE "result_status" ADD VALUE 'LOCKED';

-- CreateTable
CREATE TABLE "exam_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "default_weight" DECIMAL(8,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "halls" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "type" "hall_type" NOT NULL DEFAULT 'PHYSICAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "halls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_timetable_slots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_subject_id" UUID NOT NULL,
    "hall_id" UUID,
    "date" DATE NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_timetable_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_timetable_slot_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "hall_id" UUID NOT NULL,
    "seat_number" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invigilation_duties" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_timetable_slot_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "hall_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invigilation_duties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attendance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_timetable_slot_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_audits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_result_id" UUID NOT NULL,
    "previous_score" DECIMAL(8,2),
    "new_score" DECIMAL(8,2),
    "changed_by" VARCHAR(150) NOT NULL,
    "reason" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recheck_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_result_id" UUID NOT NULL,
    "requested_by" VARCHAR(150) NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "recheck_status" NOT NULL DEFAULT 'PENDING',
    "outcome_note" TEXT,

    CONSTRAINT "recheck_requests_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "exam_type_id" UUID,
ADD COLUMN     "published_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "exam_subjects" ADD COLUMN     "weight" DECIMAL(8,2),
ADD COLUMN     "reviewed_by_name" VARCHAR(150),
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "exam_results" ADD COLUMN     "moderated_by_name" VARCHAR(150),
ADD COLUMN     "moderation_note" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "exam_types_tenant_id_name_key" ON "exam_types"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "exam_types_id_tenant_id_key" ON "exam_types"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "halls_tenant_id_name_key" ON "halls"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "halls_id_tenant_id_key" ON "halls"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_timetable_slots_id_tenant_id_key" ON "exam_timetable_slots"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "exam_timetable_slots_tenant_id_exam_subject_id_idx" ON "exam_timetable_slots"("tenant_id", "exam_subject_id");

-- CreateIndex
CREATE INDEX "exam_timetable_slots_tenant_id_date_idx" ON "exam_timetable_slots"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_exam_timetable_slot_id_student_id_key" ON "seat_assignments"("exam_timetable_slot_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_exam_timetable_slot_id_hall_id_seat_number_key" ON "seat_assignments"("exam_timetable_slot_id", "hall_id", "seat_number");

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_id_tenant_id_key" ON "seat_assignments"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "seat_assignments_tenant_id_exam_timetable_slot_id_idx" ON "seat_assignments"("tenant_id", "exam_timetable_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "invigilation_duties_exam_timetable_slot_id_teacher_id_key" ON "invigilation_duties"("exam_timetable_slot_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "invigilation_duties_id_tenant_id_key" ON "invigilation_duties"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "invigilation_duties_tenant_id_exam_timetable_slot_id_idx" ON "invigilation_duties"("tenant_id", "exam_timetable_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attendance_records_exam_timetable_slot_id_student_id_key" ON "exam_attendance_records"("exam_timetable_slot_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attendance_records_id_tenant_id_key" ON "exam_attendance_records"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "exam_attendance_records_tenant_id_exam_timetable_slot_id_idx" ON "exam_attendance_records"("tenant_id", "exam_timetable_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_audits_id_tenant_id_key" ON "result_audits"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "result_audits_tenant_id_exam_result_id_idx" ON "result_audits"("tenant_id", "exam_result_id");

-- CreateIndex
CREATE UNIQUE INDEX "recheck_requests_exam_result_id_tenant_id_key" ON "recheck_requests"("exam_result_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "recheck_requests_id_tenant_id_key" ON "recheck_requests"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "recheck_requests_tenant_id_status_idx" ON "recheck_requests"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "exam_types" ADD CONSTRAINT "exam_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "halls" ADD CONSTRAINT "halls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_timetable_slots" ADD CONSTRAINT "exam_timetable_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_timetable_slots" ADD CONSTRAINT "exam_timetable_slots_exam_subject_id_tenant_id_fkey" FOREIGN KEY ("exam_subject_id", "tenant_id") REFERENCES "exam_subjects"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_timetable_slots" ADD CONSTRAINT "exam_timetable_slots_hall_id_tenant_id_fkey" FOREIGN KEY ("hall_id", "tenant_id") REFERENCES "halls"("id", "tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_exam_timetable_slot_id_tenant_id_fkey" FOREIGN KEY ("exam_timetable_slot_id", "tenant_id") REFERENCES "exam_timetable_slots"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_hall_id_tenant_id_fkey" FOREIGN KEY ("hall_id", "tenant_id") REFERENCES "halls"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invigilation_duties" ADD CONSTRAINT "invigilation_duties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invigilation_duties" ADD CONSTRAINT "invigilation_duties_exam_timetable_slot_id_tenant_id_fkey" FOREIGN KEY ("exam_timetable_slot_id", "tenant_id") REFERENCES "exam_timetable_slots"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invigilation_duties" ADD CONSTRAINT "invigilation_duties_teacher_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invigilation_duties" ADD CONSTRAINT "invigilation_duties_hall_id_tenant_id_fkey" FOREIGN KEY ("hall_id", "tenant_id") REFERENCES "halls"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attendance_records" ADD CONSTRAINT "exam_attendance_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attendance_records" ADD CONSTRAINT "exam_attendance_records_exam_timetable_slot_id_tenant_id_fkey" FOREIGN KEY ("exam_timetable_slot_id", "tenant_id") REFERENCES "exam_timetable_slots"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attendance_records" ADD CONSTRAINT "exam_attendance_records_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_audits" ADD CONSTRAINT "result_audits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_audits" ADD CONSTRAINT "result_audits_exam_result_id_tenant_id_fkey" FOREIGN KEY ("exam_result_id", "tenant_id") REFERENCES "exam_results"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recheck_requests" ADD CONSTRAINT "recheck_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recheck_requests" ADD CONSTRAINT "recheck_requests_exam_result_id_tenant_id_fkey" FOREIGN KEY ("exam_result_id", "tenant_id") REFERENCES "exam_results"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_exam_type_id_tenant_id_fkey" FOREIGN KEY ("exam_type_id", "tenant_id") REFERENCES "exam_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
