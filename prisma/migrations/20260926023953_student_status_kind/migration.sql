-- AlterEnum (additive only: existing student rows keep their meaning)
ALTER TYPE "student_status" ADD VALUE 'POSTPONED';
ALTER TYPE "student_status" ADD VALUE 'FIRED';

-- CreateEnum
CREATE TYPE "result_kind" AS ENUM ('MAJOR', 'CASUAL');

-- AlterTable
ALTER TABLE "exam_results" ADD COLUMN     "kind" "result_kind" NOT NULL DEFAULT 'MAJOR';
