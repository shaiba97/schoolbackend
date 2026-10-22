-- Flat yearly prices.
--
-- EXPAND phase, then a contract change. Two things happen here:
--
-- 1. `monthly_price` becomes `yearly_price`. A tier carries one flat
--    yearly price, and a quoted licence bills a yearly rate, so the column
--    was named for the wrong thing. Only this code reads it (it was added
--    the same day), so the rename is safe.
-- 2. `price_max` goes. A tier has one price; the range a quoted tier
--    carries is the rate on the licence itself. Nothing else reads the
--    column either.
--
-- The console shows the monthly equivalent, which is calculated from the
-- yearly price, not stored.
--
-- DOWN: ALTER TABLE "tenant_licenses" RENAME COLUMN "yearly_price" TO "monthly_price";
--       ALTER TABLE "platform_plans" ADD COLUMN "price_max" DECIMAL(12,2);

ALTER TABLE "tenant_licenses" RENAME COLUMN "monthly_price" TO "yearly_price";
ALTER TABLE "platform_plans" DROP COLUMN "price_max";
