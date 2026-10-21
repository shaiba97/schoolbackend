-- Staff attendance (admin-marked, teacher-read). Additive only: new enum type
-- plus new table. No existing table is altered.
CREATE TYPE "staff_attendance_status" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE');

CREATE TABLE "staff_attendance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" "staff_attendance_status" NOT NULL DEFAULT 'PRESENT',
    "left_at" VARCHAR(5),
    "remarks" TEXT,
    "marked_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_attendance_tenant_id_teacher_id_attendance_date_key" ON "staff_attendance"("tenant_id", "teacher_id", "attendance_date");
CREATE UNIQUE INDEX "staff_attendance_id_tenant_id_key" ON "staff_attendance"("id", "tenant_id");
CREATE INDEX "staff_attendance_tenant_id_attendance_date_idx" ON "staff_attendance"("tenant_id", "attendance_date");

ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_teacher_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
