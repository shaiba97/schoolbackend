-- Examination Center redesign: purely additive. No existing table, column,
-- index, or constraint is altered or dropped here.

-- Prerequisite: the legacy scheduling subsystem (halls, slots, seats) was
-- never deployed to production, but the Rooms wizard needs halls. Create the
-- minimal halls table (IF NOT EXISTS: dev databases may already have it).
DO $$ BEGIN
  CREATE TYPE "hall_type" AS ENUM ('PHYSICAL', 'VIRTUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS "halls" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "capacity" INTEGER NOT NULL,
  "type" "hall_type" NOT NULL DEFAULT 'PHYSICAL',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "halls_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "halls_tenant_id_name_key" ON "halls"("tenant_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "halls_id_tenant_id_key" ON "halls"("id", "tenant_id");
DO $$ BEGIN
  ALTER TABLE "halls" ADD CONSTRAINT "halls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Exam authorship + all-classes grouping.
ALTER TABLE "exams" ADD COLUMN "author_id" UUID;
ALTER TABLE "exams" ADD COLUMN "exam_group_id" VARCHAR(36);
ALTER TABLE "exams" ADD CONSTRAINT "exams_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "exams_tenant_id_exam_group_id_idx" ON "exams"("tenant_id", "exam_group_id");

-- Result submitter (nullable: historic rows predate it).
ALTER TABLE "exam_results" ADD COLUMN "submitted_by" UUID;
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Persisted seating order on legacy seat assignments (guarded: production
-- never received the legacy scheduling tables; dev databases have them).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seat_assignments') THEN
    ALTER TABLE "seat_assignments" ADD COLUMN "seat_order" INTEGER;
  END IF;
END $$;

-- Room-centric assignment aggregate.
CREATE TABLE "exam_room_assignments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "exam_id" UUID NOT NULL,
  "hall_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exam_room_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "exam_room_assignments_exam_id_hall_id_key" ON "exam_room_assignments"("exam_id", "hall_id");
CREATE UNIQUE INDEX "exam_room_assignments_id_tenant_id_key" ON "exam_room_assignments"("id", "tenant_id");
CREATE INDEX "exam_room_assignments_tenant_id_exam_id_idx" ON "exam_room_assignments"("tenant_id", "exam_id");
ALTER TABLE "exam_room_assignments" ADD CONSTRAINT "exam_room_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_room_assignments" ADD CONSTRAINT "exam_room_assignments_exam_id_tenant_id_fkey" FOREIGN KEY ("exam_id", "tenant_id") REFERENCES "exams"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_room_assignments" ADD CONSTRAINT "exam_room_assignments_hall_id_tenant_id_fkey" FOREIGN KEY ("hall_id", "tenant_id") REFERENCES "halls"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "exam_room_invigilators" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "exam_room_assignment_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exam_room_invigilators_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "exam_room_invigilators_assignment_teacher_key" ON "exam_room_invigilators"("exam_room_assignment_id", "teacher_id");
CREATE UNIQUE INDEX "exam_room_invigilators_id_tenant_id_key" ON "exam_room_invigilators"("id", "tenant_id");
CREATE INDEX "exam_room_invigilators_tenant_id_assignment_idx" ON "exam_room_invigilators"("tenant_id", "exam_room_assignment_id");
ALTER TABLE "exam_room_invigilators" ADD CONSTRAINT "exam_room_invigilators_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_room_invigilators" ADD CONSTRAINT "exam_room_invigilators_assignment_tenant_fkey" FOREIGN KEY ("exam_room_assignment_id", "tenant_id") REFERENCES "exam_room_assignments"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_room_invigilators" ADD CONSTRAINT "exam_room_invigilators_teacher_tenant_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "exam_room_students" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "exam_room_assignment_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "seat_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exam_room_students_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "exam_room_students_assignment_student_key" ON "exam_room_students"("exam_room_assignment_id", "student_id");
CREATE UNIQUE INDEX "exam_room_students_id_tenant_id_key" ON "exam_room_students"("id", "tenant_id");
CREATE INDEX "exam_room_students_tenant_id_assignment_idx" ON "exam_room_students"("tenant_id", "exam_room_assignment_id");
ALTER TABLE "exam_room_students" ADD CONSTRAINT "exam_room_students_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_room_students" ADD CONSTRAINT "exam_room_students_assignment_tenant_fkey" FOREIGN KEY ("exam_room_assignment_id", "tenant_id") REFERENCES "exam_room_assignments"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_room_students" ADD CONSTRAINT "exam_room_students_student_tenant_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
