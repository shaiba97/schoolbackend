-- Examination Center parity backfill (purely additive).
--
-- Production never received 20260925133914_examination_center,
-- 20260925181301_exam_sample_object_key, or the exam parts of
-- 20260926023953_student_status_kind, so the Types tab, grading weights,
-- sample papers, result kinds, and the whole scheduling subsystem are broken
-- there. This replays exactly those effects (nothing more) with guards so it
-- also applies cleanly on databases that already have them.
-- It intentionally does NOT touch _prisma_migrations bookkeeping, matching
-- the standing direct-SQL convention for this project.

-- ---------------------------------------------------------------------------
-- Enums (one statement: each value guarded so reruns stay clean)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  BEGIN
    CREATE TYPE "recheck_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "result_kind" AS ENUM ('MAJOR', 'CASUAL');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'exam_status' AND e.enumlabel = 'MARKS_OPEN') THEN
      ALTER TYPE "exam_status" ADD VALUE 'MARKS_OPEN';
    END IF;
  END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'exam_status' AND e.enumlabel = 'MODERATION') THEN
      ALTER TYPE "exam_status" ADD VALUE 'MODERATION';
    END IF;
  END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'exam_status' AND e.enumlabel = 'PROCESSED') THEN
      ALTER TYPE "exam_status" ADD VALUE 'PROCESSED';
    END IF;
  END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'exam_status' AND e.enumlabel = 'CLOSED') THEN
      ALTER TYPE "exam_status" ADD VALUE 'CLOSED';
    END IF;
  END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'result_status' AND e.enumlabel = 'SUBMITTED') THEN
      ALTER TYPE "result_status" ADD VALUE 'SUBMITTED';
    END IF;
  END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'result_status' AND e.enumlabel = 'MODERATED') THEN
      ALTER TYPE "result_status" ADD VALUE 'MODERATED';
    END IF;
  END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'result_status' AND e.enumlabel = 'LOCKED') THEN
      ALTER TYPE "result_status" ADD VALUE 'LOCKED';
    END IF;
  END;
  -- Shipped student fire/postpone flows need these values too.
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'student_status' AND e.enumlabel = 'POSTPONED') THEN
      ALTER TYPE "student_status" ADD VALUE 'POSTPONED';
    END IF;
  END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'student_status' AND e.enumlabel = 'FIRED') THEN
      ALTER TYPE "student_status" ADD VALUE 'FIRED';
    END IF;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Missing tables (definitions identical to 20260925133914, plus seat_order
-- from the redesign migration so later diffs stay clean)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "exam_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "default_weight" DECIMAL(8,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "exam_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "exam_timetable_slots" (
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

CREATE TABLE IF NOT EXISTS "seat_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_timetable_slot_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "hall_id" UUID NOT NULL,
    "seat_number" VARCHAR(20) NOT NULL,
    "seat_order" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seat_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invigilation_duties" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_timetable_slot_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "hall_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invigilation_duties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "exam_attendance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_timetable_slot_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "exam_attendance_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "result_audits" (
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

CREATE TABLE IF NOT EXISTS "recheck_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_result_id" UUID NOT NULL,
    "requested_by" VARCHAR(150) NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "recheck_status" NOT NULL DEFAULT 'PENDING',
    "outcome_note" TEXT,
    CONSTRAINT "recheck_requests_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Missing columns on existing tables
-- ---------------------------------------------------------------------------
ALTER TABLE "exams"
  ADD COLUMN IF NOT EXISTS "exam_type_id" UUID,
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "sample_object_key" TEXT;

ALTER TABLE "exam_subjects"
  ADD COLUMN IF NOT EXISTS "weight" DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS "reviewed_by_name" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "review_note" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ(6);

ALTER TABLE "exam_results"
  ADD COLUMN IF NOT EXISTS "moderated_by_name" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "moderation_note" TEXT,
  ADD COLUMN IF NOT EXISTS "kind" "result_kind" NOT NULL DEFAULT 'MAJOR';

-- ---------------------------------------------------------------------------
-- Indexes for the backfilled tables
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "exam_types_tenant_id_name_key" ON "exam_types"("tenant_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_types_id_tenant_id_key" ON "exam_types"("id", "tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_timetable_slots_id_tenant_id_key" ON "exam_timetable_slots"("id", "tenant_id");
CREATE INDEX IF NOT EXISTS "exam_timetable_slots_tenant_id_exam_subject_id_idx" ON "exam_timetable_slots"("tenant_id", "exam_subject_id");
CREATE INDEX IF NOT EXISTS "exam_timetable_slots_tenant_id_date_idx" ON "exam_timetable_slots"("tenant_id", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "seat_assignments_exam_timetable_slot_id_student_id_key" ON "seat_assignments"("exam_timetable_slot_id", "student_id");
CREATE UNIQUE INDEX IF NOT EXISTS "seat_assignments_exam_timetable_slot_id_hall_id_seat_number_key" ON "seat_assignments"("exam_timetable_slot_id", "hall_id", "seat_number");
CREATE UNIQUE INDEX IF NOT EXISTS "seat_assignments_id_tenant_id_key" ON "seat_assignments"("id", "tenant_id");
CREATE INDEX IF NOT EXISTS "seat_assignments_tenant_id_exam_timetable_slot_id_idx" ON "seat_assignments"("tenant_id", "exam_timetable_slot_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invigilation_duties_exam_timetable_slot_id_teacher_id_key" ON "invigilation_duties"("exam_timetable_slot_id", "teacher_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invigilation_duties_id_tenant_id_key" ON "invigilation_duties"("id", "tenant_id");
CREATE INDEX IF NOT EXISTS "invigilation_duties_tenant_id_exam_timetable_slot_id_idx" ON "invigilation_duties"("tenant_id", "exam_timetable_slot_id");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_attendance_records_exam_timetable_slot_id_student_id_key" ON "exam_attendance_records"("exam_timetable_slot_id", "student_id");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_attendance_records_id_tenant_id_key" ON "exam_attendance_records"("id", "tenant_id");
CREATE INDEX IF NOT EXISTS "exam_attendance_records_tenant_id_exam_timetable_slot_id_idx" ON "exam_attendance_records"("tenant_id", "exam_timetable_slot_id");
CREATE UNIQUE INDEX IF NOT EXISTS "result_audits_id_tenant_id_key" ON "result_audits"("id", "tenant_id");
CREATE INDEX IF NOT EXISTS "result_audits_tenant_id_exam_result_id_idx" ON "result_audits"("tenant_id", "exam_result_id");
CREATE UNIQUE INDEX IF NOT EXISTS "recheck_requests_exam_result_id_tenant_id_key" ON "recheck_requests"("exam_result_id", "tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "recheck_requests_id_tenant_id_key" ON "recheck_requests"("id", "tenant_id");
CREATE INDEX IF NOT EXISTS "recheck_requests_tenant_id_status_idx" ON "recheck_requests"("tenant_id", "status");

-- ---------------------------------------------------------------------------
-- Foreign keys (one statement: each guarded so reruns stay clean)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  BEGIN
    ALTER TABLE "exam_types" ADD CONSTRAINT "exam_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "exam_timetable_slots" ADD CONSTRAINT "exam_timetable_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "exam_timetable_slots" ADD CONSTRAINT "exam_timetable_slots_exam_subject_id_tenant_id_fkey" FOREIGN KEY ("exam_subject_id", "tenant_id") REFERENCES "exam_subjects"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "exam_timetable_slots" ADD CONSTRAINT "exam_timetable_slots_hall_id_tenant_id_fkey" FOREIGN KEY ("hall_id", "tenant_id") REFERENCES "halls"("id", "tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_exam_timetable_slot_id_tenant_id_fkey" FOREIGN KEY ("exam_timetable_slot_id", "tenant_id") REFERENCES "exam_timetable_slots"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_hall_id_tenant_id_fkey" FOREIGN KEY ("hall_id", "tenant_id") REFERENCES "halls"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "invigilation_duties" ADD CONSTRAINT "invigilation_duties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "invigilation_duties" ADD CONSTRAINT "invigilation_duties_exam_timetable_slot_id_tenant_id_fkey" FOREIGN KEY ("exam_timetable_slot_id", "tenant_id") REFERENCES "exam_timetable_slots"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "invigilation_duties" ADD CONSTRAINT "invigilation_duties_teacher_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "invigilation_duties" ADD CONSTRAINT "invigilation_duties_hall_id_tenant_id_fkey" FOREIGN KEY ("hall_id", "tenant_id") REFERENCES "halls"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "exam_attendance_records" ADD CONSTRAINT "exam_attendance_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "exam_attendance_records" ADD CONSTRAINT "exam_attendance_records_exam_timetable_slot_id_tenant_id_fkey" FOREIGN KEY ("exam_timetable_slot_id", "tenant_id") REFERENCES "exam_timetable_slots"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "exam_attendance_records" ADD CONSTRAINT "exam_attendance_records_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "result_audits" ADD CONSTRAINT "result_audits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "result_audits" ADD CONSTRAINT "result_audits_exam_result_id_tenant_id_fkey" FOREIGN KEY ("exam_result_id", "tenant_id") REFERENCES "exam_results"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "recheck_requests" ADD CONSTRAINT "recheck_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "recheck_requests" ADD CONSTRAINT "recheck_requests_exam_result_id_tenant_id_fkey" FOREIGN KEY ("exam_result_id", "tenant_id") REFERENCES "exam_results"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "exams" ADD CONSTRAINT "exams_exam_type_id_tenant_id_fkey" FOREIGN KEY ("exam_type_id", "tenant_id") REFERENCES "exam_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
