-- CreateEnum
CREATE TYPE "discount_source_type" AS ENUM ('SIBLING', 'TOPPER', 'FAMILY_CONDITION', 'MANUAL');

-- CreateTable
CREATE TABLE "topper_discount_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "value_type" "deduction_value_type" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topper_discount_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topper_discount_rules_tenant_id_name_key" ON "topper_discount_rules"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "topper_discount_rules_id_tenant_id_key" ON "topper_discount_rules"("id", "tenant_id");

-- CreateTable
CREATE TABLE "discount_eligibilities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "source_type" "discount_source_type" NOT NULL,
    "source_ref_id" UUID,
    "value_type" "deduction_value_type" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "academic_year_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "applied_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "applied_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_eligibilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_eligibilities_id_tenant_id_key" ON "discount_eligibilities"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "discount_eligibilities_tenant_id_student_id_idx" ON "discount_eligibilities"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "discount_eligibilities_tenant_id_academic_year_id_idx" ON "discount_eligibilities"("tenant_id", "academic_year_id");

-- CreateTable
CREATE TABLE "discount_applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "student_fee_structure_id" UUID NOT NULL,
    "eligibility_id" UUID NOT NULL,
    "payment_id" UUID,
    "target_kind" "payment_allocation_kind" NOT NULL,
    "installment_no" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_applications_id_tenant_id_key" ON "discount_applications"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "discount_applications_tenant_id_student_fee_structure_id_idx" ON "discount_applications"("tenant_id", "student_fee_structure_id");

-- CreateIndex
CREATE INDEX "discount_applications_tenant_id_eligibility_id_idx" ON "discount_applications"("tenant_id", "eligibility_id");

-- CreateIndex
CREATE INDEX "discount_applications_tenant_id_payment_id_idx" ON "discount_applications"("tenant_id", "payment_id");

-- AddForeignKey
ALTER TABLE "topper_discount_rules" ADD CONSTRAINT "topper_discount_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_eligibilities" ADD CONSTRAINT "discount_eligibilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_eligibilities" ADD CONSTRAINT "discount_eligibilities_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_eligibilities" ADD CONSTRAINT "discount_eligibilities_academic_year_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "tenant_id") REFERENCES "academic_years"("id", "tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_student_fee_structure_id_tenant_id_fkey" FOREIGN KEY ("student_fee_structure_id", "tenant_id") REFERENCES "student_fee_structures"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_eligibility_id_tenant_id_fkey" FOREIGN KEY ("eligibility_id", "tenant_id") REFERENCES "discount_eligibilities"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_payment_id_tenant_id_fkey" FOREIGN KEY ("payment_id", "tenant_id") REFERENCES "payments"("id", "tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;
