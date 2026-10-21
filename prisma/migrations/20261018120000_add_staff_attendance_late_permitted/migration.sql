-- Add LATE and PERMITTED to StaffAttendanceStatus enum
ALTER TYPE "public"."staff_attendance_status" ADD VALUE IF NOT EXISTS 'LATE';
ALTER TYPE "public"."staff_attendance_status" ADD VALUE IF NOT EXISTS 'PERMITTED';