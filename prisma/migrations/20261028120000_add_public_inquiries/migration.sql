-- The public sales intake for the marketing site: prospect schools submit
-- the landing page's contact form with no account to authenticate, so the
-- table carries no tenant linkage and the platform-only console
-- (pricing/licensing screens) is the only place that ever lists its rows.

CREATE TYPE "inquiry_region" AS ENUM ('SUDAN', 'EGYPT', 'GCC_KSA', 'GCC_UAE', 'GCC_KUWAIT', 'GCC_QATAR', 'GCC_OMAN', 'GCC_BAHRAIN');
CREATE TYPE "inquiry_status" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

CREATE TABLE "inquiries" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "school_name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "region" "inquiry_region" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "inquiry_status" NOT NULL DEFAULT 'NEW',
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inquiries_status_idx" ON "inquiries"("status");
CREATE INDEX "inquiries_created_at_idx" ON "inquiries"("created_at");
