-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'INACTIVE', 'INVITED');

-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('ACTIVE', 'COMPLETED', 'TRANSFERRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "teacher_status" AS ENUM ('ACTIVE', 'INACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "exam_status" AS ENUM ('DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "result_status" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "fee_frequency" AS ENUM ('ONE_TIME', 'MONTHLY', 'TERMLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'MOBILE_MONEY', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "role_scope" AS ENUM ('SYSTEM', 'TENANT');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'READ', 'EXPORT', 'PUBLISH', 'APPROVE', 'REJECT', 'REFUND', 'OTHER');

-- CreateEnum
CREATE TYPE "day_of_week" AS ENUM ('SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(30),
    "logo_url" TEXT,
    "website_url" TEXT,
    "country_code" CHAR(2),
    "currency_code" CHAR(3) NOT NULL DEFAULT 'SDG',
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(30),
    "password_hash" TEXT,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100),
    "avatar_url" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ(6),
    "phone_verified_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "scope" "role_scope" NOT NULL DEFAULT 'TENANT',
    "is_system_role" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id","role_id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_terms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "sequence_no" INTEGER NOT NULL,

    CONSTRAINT "academic_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_classes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,
    "sequence_no" INTEGER,

    CONSTRAINT "school_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "capacity" INTEGER,
    "class_teacher_id" UUID,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "admission_number" VARCHAR(100) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "date_of_birth" DATE,
    "gender" "gender",
    "phone" VARCHAR(30),
    "email" VARCHAR(320),
    "address" TEXT,
    "photo_url" TEXT,
    "admission_date" DATE,
    "status" "student_status" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100),
    "phone" VARCHAR(30),
    "email" VARCHAR(320),
    "address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "relationship" VARCHAR(50) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "can_pickup" BOOLEAN NOT NULL DEFAULT true,
    "emergency_contact" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_number" VARCHAR(100),
    "hire_date" DATE,
    "specialization" TEXT,
    "status" "teacher_status" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "enrolled_on" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "enrollment_status" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "teacher_id" UUID,

    CONSTRAINT "section_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID,
    "teacher_id" UUID,
    "attendance_date" DATE NOT NULL,
    "session_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "attendance_session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "attendance_status" NOT NULL,
    "remarks" TEXT,
    "marked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "term_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "starts_on" DATE,
    "ends_on" DATE,
    "status" "exam_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "section_subject_id" UUID NOT NULL,
    "grading_scale_id" UUID,
    "exam_date" DATE,
    "max_marks" DECIMAL(8,2) NOT NULL,
    "passing_marks" DECIMAL(8,2),

    CONSTRAINT "exam_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_results" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_subject_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "marks" DECIMAL(8,2),
    "grade" VARCHAR(10),
    "remarks" TEXT,
    "status" "result_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,

    CONSTRAINT "fee_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_id" UUID,
    "fee_type_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "frequency" "fee_frequency" NOT NULL DEFAULT 'ONE_TIME',

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID,
    "invoice_number" VARCHAR(100) NOT NULL,
    "issue_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency_code" CHAR(3) NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "fee_type_id" UUID,
    "description" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "payment_reference" VARCHAR(100),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'COMPLETED',
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "channel" "notification_channel" NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "read_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notification_type" VARCHAR(50) NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "action" "audit_action" NOT NULL,
    "entity_type" VARCHAR(100),
    "entity_id" UUID,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "term_id" UUID,
    "section_subject_id" UUID NOT NULL,
    "day_of_week" "day_of_week" NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,
    "period_no" INTEGER NOT NULL,
    "room" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_scales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grading_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_bands" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "grading_scale_id" UUID NOT NULL,
    "min_percent" DECIMAL(5,2) NOT NULL,
    "max_percent" DECIMAL(5,2) NOT NULL,
    "grade" VARCHAR(10) NOT NULL,
    "points" DECIMAL(4,2),
    "remark" VARCHAR(50),

    CONSTRAINT "grading_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "date" DATE NOT NULL,
    "term_id" UUID,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");

-- CreateIndex
CREATE INDEX "tenant_memberships_tenant_id_status_idx" ON "tenant_memberships"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_slug_key" ON "roles"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "membership_roles_role_id_idx" ON "membership_roles"("role_id");

-- CreateIndex
CREATE INDEX "academic_years_tenant_id_is_current_idx" ON "academic_years"("tenant_id", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_tenant_id_name_key" ON "academic_years"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_id_tenant_id_key" ON "academic_years"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "academic_terms_tenant_id_academic_year_id_idx" ON "academic_terms"("tenant_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_terms_academic_year_id_sequence_no_key" ON "academic_terms"("academic_year_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "academic_terms_id_tenant_id_key" ON "academic_terms"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "school_classes_tenant_id_sequence_no_idx" ON "school_classes"("tenant_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "school_classes_tenant_id_name_key" ON "school_classes"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "school_classes_id_tenant_id_key" ON "school_classes"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "sections_tenant_id_class_id_idx" ON "sections"("tenant_id", "class_id");

-- CreateIndex
CREATE INDEX "sections_tenant_id_class_teacher_id_idx" ON "sections"("tenant_id", "class_teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_class_id_name_key" ON "sections"("class_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sections_id_tenant_id_key" ON "sections"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");

-- CreateIndex
CREATE INDEX "students_tenant_id_status_idx" ON "students"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "students_tenant_id_last_name_first_name_idx" ON "students"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_admission_number_key" ON "students"("tenant_id", "admission_number");

-- CreateIndex
CREATE UNIQUE INDEX "students_id_tenant_id_key" ON "students"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_user_id_key" ON "guardians"("user_id");

-- CreateIndex
CREATE INDEX "guardians_tenant_id_last_name_first_name_idx" ON "guardians"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "guardians_tenant_id_phone_idx" ON "guardians"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_id_tenant_id_key" ON "guardians"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "student_guardians_tenant_id_guardian_id_idx" ON "student_guardians"("tenant_id", "guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_user_id_key" ON "teachers"("user_id");

-- CreateIndex
CREATE INDEX "teachers_tenant_id_status_idx" ON "teachers"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_tenant_id_employee_number_key" ON "teachers"("tenant_id", "employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_id_tenant_id_key" ON "teachers"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "student_enrollments_tenant_id_section_id_idx" ON "student_enrollments"("tenant_id", "section_id");

-- CreateIndex
CREATE INDEX "student_enrollments_tenant_id_academic_year_id_idx" ON "student_enrollments"("tenant_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "student_enrollments_student_id_status_idx" ON "student_enrollments"("student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_student_id_academic_year_id_key" ON "student_enrollments"("student_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_id_tenant_id_key" ON "student_enrollments"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "subjects_tenant_id_code_idx" ON "subjects"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_tenant_id_name_key" ON "subjects"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_id_tenant_id_key" ON "subjects"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "section_subjects_tenant_id_teacher_id_idx" ON "section_subjects"("tenant_id", "teacher_id");

-- CreateIndex
CREATE INDEX "section_subjects_tenant_id_subject_id_idx" ON "section_subjects"("tenant_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_subjects_section_id_subject_id_key" ON "section_subjects"("section_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_subjects_id_tenant_id_key" ON "section_subjects"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "attendance_sessions_tenant_id_attendance_date_idx" ON "attendance_sessions"("tenant_id", "attendance_date");

-- CreateIndex
CREATE INDEX "attendance_sessions_tenant_id_section_id_attendance_date_idx" ON "attendance_sessions"("tenant_id", "section_id", "attendance_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_tenant_id_section_id_subject_id_attenda_key" ON "attendance_sessions"("tenant_id", "section_id", "subject_id", "attendance_date", "session_number");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_id_tenant_id_key" ON "attendance_sessions"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "attendance_records_tenant_id_student_id_idx" ON "attendance_records"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "attendance_records_tenant_id_status_idx" ON "attendance_records"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_attendance_session_id_student_id_key" ON "attendance_records"("attendance_session_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_id_tenant_id_key" ON "attendance_records"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "exams_tenant_id_academic_year_id_idx" ON "exams"("tenant_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "exams_tenant_id_status_idx" ON "exams"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exams_id_tenant_id_key" ON "exams"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "exam_subjects_tenant_id_exam_id_idx" ON "exam_subjects"("tenant_id", "exam_id");

-- CreateIndex
CREATE INDEX "exam_subjects_tenant_id_grading_scale_id_idx" ON "exam_subjects"("tenant_id", "grading_scale_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_exam_id_section_subject_id_key" ON "exam_subjects"("exam_id", "section_subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_id_tenant_id_key" ON "exam_subjects"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "exam_results_tenant_id_student_id_idx" ON "exam_results"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "exam_results_tenant_id_status_idx" ON "exam_results"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_results_exam_subject_id_student_id_key" ON "exam_results"("exam_subject_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_results_id_tenant_id_key" ON "exam_results"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_types_tenant_id_name_key" ON "fee_types"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "fee_types_id_tenant_id_key" ON "fee_types"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "fee_structures_tenant_id_academic_year_id_idx" ON "fee_structures"("tenant_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "fee_structures_tenant_id_class_id_idx" ON "fee_structures"("tenant_id", "class_id");

-- CreateIndex
CREATE INDEX "fee_structures_tenant_id_fee_type_id_idx" ON "fee_structures"("tenant_id", "fee_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_id_tenant_id_key" ON "fee_structures"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_student_id_idx" ON "invoices"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_status_idx" ON "invoices"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_due_date_idx" ON "invoices"("tenant_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_invoice_number_key" ON "invoices"("tenant_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_id_tenant_id_key" ON "invoices"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "invoice_items_tenant_id_invoice_id_idx" ON "invoice_items"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_id_tenant_id_key" ON "invoice_items"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_invoice_id_idx" ON "payments"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_student_id_idx" ON "payments"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_paid_at_idx" ON "payments"("tenant_id", "paid_at");

-- CreateIndex
CREATE INDEX "payments_tenant_id_payment_reference_idx" ON "payments"("tenant_id", "payment_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_tenant_id_key" ON "payments"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_status_idx" ON "notifications"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_type_idx" ON "notifications"("tenant_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_notification_type_key" ON "notification_preferences"("user_id", "notification_type");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "timetable_entries_tenant_id_day_of_week_idx" ON "timetable_entries"("tenant_id", "day_of_week");

-- CreateIndex
CREATE INDEX "timetable_entries_tenant_id_academic_year_id_idx" ON "timetable_entries"("tenant_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "timetable_entries_tenant_id_term_id_idx" ON "timetable_entries"("tenant_id", "term_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_tenant_id_section_subject_id_day_of_week__key" ON "timetable_entries"("tenant_id", "section_subject_id", "day_of_week", "period_no");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_id_tenant_id_key" ON "timetable_entries"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "grading_scales_tenant_id_idx" ON "grading_scales"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "grading_scales_tenant_id_name_key" ON "grading_scales"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "grading_scales_id_tenant_id_key" ON "grading_scales"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "grading_bands_tenant_id_grading_scale_id_idx" ON "grading_bands"("tenant_id", "grading_scale_id");

-- CreateIndex
CREATE UNIQUE INDEX "grading_bands_tenant_id_grading_scale_id_grade_key" ON "grading_bands"("tenant_id", "grading_scale_id", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "grading_bands_id_tenant_id_key" ON "grading_bands"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "holidays_tenant_id_date_idx" ON "holidays"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_tenant_id_date_key" ON "holidays"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_id_tenant_id_key" ON "holidays"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_academic_year_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "tenant_id") REFERENCES "academic_years"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "school_classes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_teacher_id_tenant_id_fkey" FOREIGN KEY ("class_teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_tenant_id_fkey" FOREIGN KEY ("guardian_id", "tenant_id") REFERENCES "guardians"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_academic_year_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "tenant_id") REFERENCES "academic_years"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_tenant_id_fkey" FOREIGN KEY ("section_id", "tenant_id") REFERENCES "sections"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_section_id_tenant_id_fkey" FOREIGN KEY ("section_id", "tenant_id") REFERENCES "sections"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_subject_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "tenant_id") REFERENCES "subjects"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_teacher_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_id_tenant_id_fkey" FOREIGN KEY ("section_id", "tenant_id") REFERENCES "sections"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_subject_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "tenant_id") REFERENCES "subjects"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_teacher_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "tenant_id") REFERENCES "teachers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_attendance_session_id_tenant_id_fkey" FOREIGN KEY ("attendance_session_id", "tenant_id") REFERENCES "attendance_sessions"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_academic_year_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "tenant_id") REFERENCES "academic_years"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_term_id_tenant_id_fkey" FOREIGN KEY ("term_id", "tenant_id") REFERENCES "academic_terms"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_exam_id_tenant_id_fkey" FOREIGN KEY ("exam_id", "tenant_id") REFERENCES "exams"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_section_subject_id_tenant_id_fkey" FOREIGN KEY ("section_subject_id", "tenant_id") REFERENCES "section_subjects"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_grading_scale_id_tenant_id_fkey" FOREIGN KEY ("grading_scale_id", "tenant_id") REFERENCES "grading_scales"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_exam_subject_id_tenant_id_fkey" FOREIGN KEY ("exam_subject_id", "tenant_id") REFERENCES "exam_subjects"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academic_year_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "tenant_id") REFERENCES "academic_years"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "school_classes"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_fee_type_id_tenant_id_fkey" FOREIGN KEY ("fee_type_id", "tenant_id") REFERENCES "fee_types"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_academic_year_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "tenant_id") REFERENCES "academic_years"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_tenant_id_fkey" FOREIGN KEY ("invoice_id", "tenant_id") REFERENCES "invoices"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_fee_type_id_tenant_id_fkey" FOREIGN KEY ("fee_type_id", "tenant_id") REFERENCES "fee_types"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_tenant_id_fkey" FOREIGN KEY ("invoice_id", "tenant_id") REFERENCES "invoices"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_academic_year_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "tenant_id") REFERENCES "academic_years"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_term_id_tenant_id_fkey" FOREIGN KEY ("term_id", "tenant_id") REFERENCES "academic_terms"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_section_subject_id_tenant_id_fkey" FOREIGN KEY ("section_subject_id", "tenant_id") REFERENCES "section_subjects"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_scales" ADD CONSTRAINT "grading_scales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_bands" ADD CONSTRAINT "grading_bands_grading_scale_id_tenant_id_fkey" FOREIGN KEY ("grading_scale_id", "tenant_id") REFERENCES "grading_scales"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_term_id_tenant_id_fkey" FOREIGN KEY ("term_id", "tenant_id") REFERENCES "academic_terms"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
