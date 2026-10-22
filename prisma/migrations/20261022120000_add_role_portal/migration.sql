-- The portal a position belongs to.
--
-- EXPAND phase only: one nullable column on roles, plus an index. A school
-- may only hold positions for the portals its plan tier grants, and the
-- portal has to be recorded on the role to check that later. A null portal
-- is a role that is not tied to a portal (the seeded ADMIN role, and any
-- role created before this migration).
--
-- DOWN: ALTER TABLE "roles" DROP COLUMN "portal";

ALTER TABLE "roles" ADD COLUMN "portal" "portal_module";
CREATE INDEX "roles_portal_idx" ON "roles"("portal");
