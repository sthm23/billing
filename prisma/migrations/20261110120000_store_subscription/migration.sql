-- Store subscription status (trial / active / suspended), application data, attribute unit

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StoreSuspendReason" AS ENUM ('UNPAID', 'OWNER_REQUEST', 'OTHER');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "status" "StoreStatus" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "paidUntil" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedById" TEXT,
ADD COLUMN     "suspendReason" "StoreSuspendReason",
ADD COLUMN     "suspendComment" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "inn" TEXT,
ADD COLUMN     "note" TEXT;

-- Stores that existed before subscriptions keep working as active
UPDATE "stores" SET "status" = 'ACTIVE';

-- AlterTable
ALTER TABLE "attributes" ADD COLUMN     "unit" TEXT;
