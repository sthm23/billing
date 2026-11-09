-- Rental dry cleaning planned outside a return (R13): blocks one unit, expense in the cashbox
-- CreateEnum
CREATE TYPE "RentalCleaningStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "CashTransactionCategory" ADD VALUE 'DRY_CLEANING';

-- CreateTable
CREATE TABLE "rental_cleanings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "comment" TEXT,
    "status" "RentalCleaningStatus" NOT NULL DEFAULT 'ACTIVE',
    "expenseTransactionId" TEXT NOT NULL,
    "refundTransactionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "rental_cleanings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_cleanings_expenseTransactionId_key" ON "rental_cleanings"("expenseTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_cleanings_refundTransactionId_key" ON "rental_cleanings"("refundTransactionId");

-- CreateIndex
CREATE INDEX "rental_cleanings_warehouseId_variantId_endDate_idx" ON "rental_cleanings"("warehouseId", "variantId", "endDate");

-- CreateIndex
CREATE INDEX "rental_cleanings_storeId_startDate_idx" ON "rental_cleanings"("storeId", "startDate");

-- AddForeignKey
ALTER TABLE "rental_cleanings" ADD CONSTRAINT "rental_cleanings_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_cleanings" ADD CONSTRAINT "rental_cleanings_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_cleanings" ADD CONSTRAINT "rental_cleanings_expenseTransactionId_fkey" FOREIGN KEY ("expenseTransactionId") REFERENCES "CashTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_cleanings" ADD CONSTRAINT "rental_cleanings_refundTransactionId_fkey" FOREIGN KEY ("refundTransactionId") REFERENCES "CashTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

