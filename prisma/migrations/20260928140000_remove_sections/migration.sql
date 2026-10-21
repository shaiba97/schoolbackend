-- Section removal: every class collapses to itself. Data is ported, never
-- dropped blindly: assignments dedupe by (class, subject) preferring rows
-- that carry a teacher; duplicate attendance sessions merge records into the
-- earliest session; supervisor moves to the class. Guard blocks abort the
-- whole migration if any port leaves orphans behind.

-- Phase 1: supervisor moves from section to class (first named section wins).
ALTER TABLE "school_classes" ADD COLUMN "class_teacher_id" UUID;
UPDATE "school_classes" c SET "class_teacher_id" = sub.teacher_id
FROM (
  SELECT DISTINCT ON (s."class_id", s."tenant_id") s."class_id", s."tenant_id", s."class_teacher_id" AS teacher_id
  FROM "sections" s
  WHERE s."class_teacher_id" IS NOT NULL
  ORDER BY s."class_id", s."tenant_id", s."name", s."id"
) sub
WHERE c."id" = sub."class_id" AND c."tenant_id" = sub."tenant_id";
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_class_teacher_id_tenant_id_fkey" FOREIGN KEY ("class_teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "school_classes_tenant_id_class_teacher_id_idx" ON "school_classes"("tenant_id", "class_teacher_id");

-- Phase 2: class-scoped assignment table.
CREATE TABLE "class_subjects" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "class_id" UUID NOT NULL,
  "subject_id" UUID NOT NULL,
  "teacher_id" UUID,
  CONSTRAINT "class_subjects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "class_subjects_class_id_subject_id_key" ON "class_subjects"("class_id", "subject_id");
CREATE UNIQUE INDEX "class_subjects_id_tenant_id_key" ON "class_subjects"("id", "tenant_id");
CREATE INDEX "class_subjects_tenant_id_teacher_id_idx" ON "class_subjects"("tenant_id", "teacher_id");
CREATE INDEX "class_subjects_tenant_id_subject_id_idx" ON "class_subjects"("tenant_id", "subject_id");
CREATE INDEX "class_subjects_tenant_id_class_id_idx" ON "class_subjects"("tenant_id", "class_id");
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "school_classes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "tenant_id") REFERENCES "subjects"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_teacher_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Port assignments: one row per (class, subject); a row carrying a teacher wins.
INSERT INTO "class_subjects" ("id", "tenant_id", "class_id", "subject_id", "teacher_id")
SELECT DISTINCT ON (s."tenant_id", s."class_id", ss."subject_id")
  gen_random_uuid(), s."tenant_id", s."class_id", ss."subject_id", ss."teacher_id"
FROM "section_subjects" ss
JOIN "sections" s ON s."id" = ss."section_id" AND s."tenant_id" = ss."tenant_id"
ORDER BY s."tenant_id", s."class_id", ss."subject_id",
  CASE WHEN ss."teacher_id" IS NULL THEN 1 ELSE 0 END, ss."id";

-- Phase 3: exam subjects re-link onto class subjects.
ALTER TABLE "exam_subjects" ADD COLUMN "class_subject_id" UUID;
UPDATE "exam_subjects" es SET "class_subject_id" = cs."id"
FROM "section_subjects" ss
JOIN "sections" s ON s."id" = ss."section_id" AND s."tenant_id" = ss."tenant_id"
JOIN "class_subjects" cs ON cs."tenant_id" = ss."tenant_id" AND cs."class_id" = s."class_id" AND cs."subject_id" = ss."subject_id"
WHERE es."section_subject_id" = ss."id" AND es."tenant_id" = ss."tenant_id";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "exam_subjects" WHERE "class_subject_id" IS NULL) THEN
    RAISE EXCEPTION 'exam_subjects port left NULL class_subject_id rows';
  END IF;
END $$;
ALTER TABLE "exam_subjects" ALTER COLUMN "class_subject_id" SET NOT NULL;
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_class_subject_id_tenant_id_fkey" FOREIGN KEY ("class_subject_id", "tenant_id") REFERENCES "class_subjects"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_subjects" DROP CONSTRAINT "exam_subjects_section_subject_id_tenant_id_fkey";
DROP INDEX IF EXISTS "exam_subjects_exam_id_section_subject_id_key";
ALTER TABLE "exam_subjects" DROP COLUMN "section_subject_id";
CREATE UNIQUE INDEX "exam_subjects_exam_id_class_subject_id_key" ON "exam_subjects"("exam_id", "class_subject_id");

-- Phase 4: enrollments move from section to class (unique per student/year already holds).
ALTER TABLE "student_enrollments" ADD COLUMN "class_id" UUID;
UPDATE "student_enrollments" e SET "class_id" = s."class_id"
FROM "sections" s WHERE s."id" = e."section_id" AND s."tenant_id" = e."tenant_id";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "student_enrollments" WHERE "class_id" IS NULL) THEN
    RAISE EXCEPTION 'student_enrollments port left NULL class_id rows';
  END IF;
END $$;
ALTER TABLE "student_enrollments" ALTER COLUMN "class_id" SET NOT NULL;
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "school_classes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_enrollments" DROP CONSTRAINT "student_enrollments_section_id_tenant_id_fkey";
DROP INDEX IF EXISTS "student_enrollments_tenant_id_section_id_idx";
ALTER TABLE "student_enrollments" DROP COLUMN "section_id";
CREATE INDEX "student_enrollments_tenant_id_class_id_idx" ON "student_enrollments"("tenant_id", "class_id");

-- Phase 5: attendance sessions move to class, merging same-slot duplicates.
ALTER TABLE "attendance_sessions" ADD COLUMN "class_id" UUID;
UPDATE "attendance_sessions" s SET "class_id" = sec."class_id"
FROM "sections" sec WHERE sec."id" = s."section_id" AND sec."tenant_id" = s."tenant_id";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "attendance_sessions" WHERE "class_id" IS NULL) THEN
    RAISE EXCEPTION 'attendance_sessions port left NULL class_id rows';
  END IF;
END $$;
CREATE TEMP TABLE "session_merge" AS
SELECT "id" AS loser_id,
  FIRST_VALUE("id") OVER (
    PARTITION BY "tenant_id", "class_id", "subject_id", "attendance_date", "session_number"
    ORDER BY "created_at", "id"
  ) AS survivor_id
FROM "attendance_sessions";
UPDATE "attendance_records" r SET "attendance_session_id" = m."survivor_id"
FROM "session_merge" m
WHERE r."attendance_session_id" = m."loser_id" AND m."loser_id" <> m."survivor_id"
  AND NOT EXISTS (
    SELECT 1 FROM "attendance_records" r2
    WHERE r2."attendance_session_id" = m."survivor_id" AND r2."student_id" = r."student_id" AND r2."tenant_id" = r."tenant_id"
  );
DELETE FROM "attendance_records" r USING "session_merge" m
WHERE r."attendance_session_id" = m."loser_id" AND m."loser_id" <> m."survivor_id";
DELETE FROM "attendance_sessions" s USING "session_merge" m
WHERE s."id" = m."loser_id" AND m."loser_id" <> m."survivor_id";
DROP TABLE "session_merge";
ALTER TABLE "attendance_sessions" ALTER COLUMN "class_id" SET NOT NULL;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "school_classes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_section_id_tenant_id_fkey";
DROP INDEX IF EXISTS "attendance_sessions_tenant_id_section_id_subject_id_attenda_key";
DROP INDEX IF EXISTS "attendance_sessions_tenant_id_section_id_attendance_date_idx";
ALTER TABLE "attendance_sessions" DROP COLUMN "section_id";
CREATE UNIQUE INDEX "attendance_sessions_class_date_session_key" ON "attendance_sessions"("tenant_id", "class_id", "subject_id", "attendance_date", "session_number");

-- Phase 6: timetable drops the legacy assignment link (denormalised fields carry the data).
ALTER TABLE "timetable_entries" DROP CONSTRAINT "timetable_entries_section_subject_id_tenant_id_fkey";
DROP INDEX IF EXISTS "timetable_entries_tenant_id_academic_year_id_term_id_section_subject_id_day_of_week_period_no_idx";
DROP INDEX IF EXISTS "timetable_entries_tenant_id_academic_year_id_term_id_sectio_idx";
ALTER TABLE "timetable_entries" DROP COLUMN "section_subject_id";

-- Phase 7: drop the old tables now that nothing references them.
DROP TABLE "section_subjects";
DROP TABLE "sections";
