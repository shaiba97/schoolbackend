-- Enforce a single primary guardian per student at the database level.
-- Prisma has no declarative syntax for partial unique indexes, so this is
-- managed manually here; it is invisible to `migrate diff` (which replays
-- migration files, not live indexes) and must be kept if the guardians
-- tables are ever rebuilt from scratch.
-- App code resets sibling primaries first, so concurrent writers serialize
-- on this index instead of silently producing two primaries.
CREATE UNIQUE INDEX "student_guardians_one_primary_per_student" ON "student_guardians"("student_id") WHERE "is_primary" = true;
