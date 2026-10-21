-- CreateTable
CREATE TABLE "approval_thresholds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "module" VARCHAR(100) NOT NULL,
    "threshold" DECIMAL(12,2) NOT NULL,
    "approver_role" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_thresholds_tenant_id_module_key" ON "approval_thresholds"("tenant_id", "module");

-- CreateIndex
CREATE UNIQUE INDEX "approval_thresholds_id_tenant_id_key" ON "approval_thresholds"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "approval_thresholds_tenant_id_is_active_idx" ON "approval_thresholds"("tenant_id", "is_active");

-- AlterTable
ALTER TABLE "financial_payment_methods" ADD COLUMN "account_name" VARCHAR(150),
ADD COLUMN "account_number" VARCHAR(100);
