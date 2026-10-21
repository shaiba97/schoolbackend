-- CreateEnum
CREATE TYPE "receipt_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "payment_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_reference" VARCHAR(100),
    "object_key" TEXT NOT NULL,
    "status" "receipt_status" NOT NULL DEFAULT 'PENDING',
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_receipts_tenant_id_invoice_id_idx" ON "payment_receipts"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_receipts_tenant_id_student_id_idx" ON "payment_receipts"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "payment_receipts_tenant_id_guardian_id_idx" ON "payment_receipts"("tenant_id", "guardian_id");

-- CreateIndex
CREATE INDEX "payment_receipts_tenant_id_status_idx" ON "payment_receipts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_id_tenant_id_key" ON "payment_receipts"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_invoice_id_tenant_id_fkey" FOREIGN KEY ("invoice_id", "tenant_id") REFERENCES "invoices"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_student_id_tenant_id_fkey" FOREIGN KEY ("student_id", "tenant_id") REFERENCES "students"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_guardian_id_tenant_id_fkey" FOREIGN KEY ("guardian_id", "tenant_id") REFERENCES "guardians"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

