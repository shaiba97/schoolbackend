-- Staff-member attendance (non-teaching staff). Additive only: new table,
-- no existing table is altered. Reuses the staff_attendance_status enum.
CREATE TABLE "staff_member_attendance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" "staff_attendance_status" NOT NULL DEFAULT 'PRESENT',
    "left_at" VARCHAR(5),
    "remarks" TEXT,
    "marked_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_member_attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_member_attendance_tenant_id_user_id_attendance_date_key" ON "staff_member_attendance"("tenant_id", "user_id", "attendance_date");
CREATE UNIQUE INDEX "staff_member_attendance_id_tenant_id_key" ON "staff_member_attendance"("id", "tenant_id");
CREATE INDEX "staff_member_attendance_tenant_id_attendance_date_idx" ON "staff_member_attendance"("tenant_id", "attendance_date");

ALTER TABLE "staff_member_attendance" ADD CONSTRAINT "staff_member_attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_member_attendance" ADD CONSTRAINT "staff_member_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
