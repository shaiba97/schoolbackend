-- The monthly price a licence bills.
--
-- EXPAND phase, with one rename. The column was added earlier the same
-- day as price_per_student, when a tier priced per student. A tier price
-- is now the school's monthly amount, so the column carries the monthly
-- rate: the same number, named for what it is. Only the new code reads
-- it, so nothing else depends on the old name.
--
-- DOWN: ALTER TABLE "tenant_licenses" RENAME COLUMN "monthly_price" TO "price_per_student";

ALTER TABLE "tenant_licenses" RENAME COLUMN "price_per_student" TO "monthly_price";
