-- Bilingual school name.
--
-- EXPAND phase only: one nullable column. A school that trades in Arabic
-- keeps its Arabic name beside the English one; `name` stays the name every
-- other surface uses, so nothing else has to change.
--
-- DOWN: ALTER TABLE "tenants" DROP COLUMN "name_ar";

ALTER TABLE "tenants" ADD COLUMN "name_ar" VARCHAR(200);
