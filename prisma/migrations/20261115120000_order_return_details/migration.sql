-- Return reason and comment (information only)
CREATE TYPE "ReturnReason" AS ENUM ('DEFECT', 'NOT_FIT', 'EXTRA', 'OTHER');
ALTER TABLE "ReturnedOrder" ADD COLUMN "reason" "ReturnReason" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "ReturnedOrder" ADD COLUMN "comment" TEXT;

-- Optional term of the debt left on an order
ALTER TABLE "orders" ADD COLUMN "debtDueAt" TIMESTAMP(3);

-- Manual expense: money for a defective item the shop does not take back
ALTER TYPE "CashTransactionCategory" ADD VALUE 'DEFECT_COMPENSATION';
