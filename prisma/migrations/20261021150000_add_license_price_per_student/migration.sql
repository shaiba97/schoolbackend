-- A quoted rate per licence.
--
-- EXPAND phase only: one nullable column. A licence with a rate bills that
-- rate per student per month; a licence without one bills the tier's list
-- price. This is what makes a "price on request" tier bill real money: the
-- tier says "price on request" and the licence carries the agreed rate.
--
-- DOWN: ALTER TABLE "tenant_licenses" DROP COLUMN "price_per_student";

ALTER TABLE "tenant_licenses" ADD COLUMN "price_per_student" DECIMAL(12,2);
