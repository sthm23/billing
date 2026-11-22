-- Employee deactivation details shown on the staff card (who, when, why)
-- CreateEnum
CREATE TYPE "StaffDeactivationReason" AS ENUM ('LEFT', 'TEMPORARY', 'OTHER');

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT,
ADD COLUMN     "deactivationReason" "StaffDeactivationReason";
