-- The reception portal.
--
-- Kept in its own file on purpose. PostgreSQL cannot use a value added by
-- ALTER TYPE ... ADD VALUE inside the transaction that added it, so the
-- value is committed here on its own before anything writes it. This is the
-- same constraint the 20261020120000 migration ran into.
--
-- DOWN: the value cannot be removed in place; a new type has to be built
-- and the column repointed. Until then the portal is simply switched off
-- for every tenant, which is what the next migration does.

ALTER TYPE "portal_module" ADD VALUE IF NOT EXISTS 'RECEPTION';
