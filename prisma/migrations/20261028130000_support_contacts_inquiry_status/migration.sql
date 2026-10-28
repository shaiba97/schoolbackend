-- Regional support contacts + console lifecycle for landing inquiry follow-up.

CREATE TYPE "contact_type" AS ENUM ('EMAIL', 'PHONE');

-- Inquiry status renames carry existing rows over unchanged:
-- NEW -> PENDING, CONTACTED -> IN_PROGRESS, CLOSED -> RESOLVED.
ALTER TYPE "inquiry_status" RENAME VALUE 'NEW' TO 'PENDING';
ALTER TYPE "inquiry_status" RENAME VALUE 'CONTACTED' TO 'IN_PROGRESS';
ALTER TYPE "inquiry_status" RENAME VALUE 'CLOSED' TO 'RESOLVED';
ALTER TYPE "inquiry_status" ADD VALUE 'ARCHIVED';

ALTER TABLE "inquiries" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "inquiries" ADD COLUMN     "subject" VARCHAR(200);
CREATE INDEX "inquiries_region_idx" ON "inquiries"("region");

CREATE TABLE "support_contacts" (
    "id" UUID NOT NULL,
    "contact" VARCHAR(255) NOT NULL,
    "contact_type" "contact_type" NOT NULL,
    "region" "inquiry_region" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_contacts_region_contact_key" ON "support_contacts"("region", "contact");
CREATE INDEX "support_contacts_region_idx" ON "support_contacts"("region");
