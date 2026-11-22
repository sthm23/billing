-- Rental (wedding salon) schema, see billing/docs/rental/01_RENTAL_DESIGN.md
-- Defaults keep existing behaviour: stores sell (salesEnabled=true, rentalEnabled=false), variants are sellable (canSell=true, canRent=false)

-- CreateEnum
CREATE TYPE "RentalStatus" AS ENUM ('BOOKED', 'ISSUED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CollateralType" AS ENUM ('PASSPORT', 'GOLD', 'OTHER');

-- AlterEnum
ALTER TYPE "CashTransactionCategory" ADD VALUE 'RENTAL';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "rentalEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salesEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "canRent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canSell" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rentPricePerDay" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "additional_services" ADD COLUMN     "sale" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "rentals" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "plannedDays" INTEGER NOT NULL,
    "status" "RentalStatus" NOT NULL DEFAULT 'BOOKED',
    "issuedAt" TIMESTAMP(3),
    "issuedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "refundAmount" DECIMAL(65,30),
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_collaterals" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "type" "CollateralType" NOT NULL,
    "description" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedBy" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "returnedBy" TEXT,

    CONSTRAINT "rental_collaterals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_returns" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3) NOT NULL,
    "penaltyAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "penaltyComment" TEXT,
    "earlyReturnRefund" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_return_items" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cleaningDays" INTEGER NOT NULL DEFAULT 0,
    "availableFrom" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rentals_orderId_key" ON "rentals"("orderId");

-- CreateIndex
CREATE INDEX "rentals_storeId_startDate_idx" ON "rentals"("storeId", "startDate");

-- CreateIndex
CREATE INDEX "rentals_warehouseId_status_idx" ON "rentals"("warehouseId", "status");

-- CreateIndex
CREATE INDEX "rental_collaterals_rentalId_idx" ON "rental_collaterals"("rentalId");

-- CreateIndex
CREATE INDEX "rental_returns_rentalId_idx" ON "rental_returns"("rentalId");

-- CreateIndex
CREATE INDEX "rental_return_items_returnId_idx" ON "rental_return_items"("returnId");

-- CreateIndex
CREATE INDEX "rental_return_items_orderItemId_idx" ON "rental_return_items"("orderItemId");

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_collaterals" ADD CONSTRAINT "rental_collaterals_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_returns" ADD CONSTRAINT "rental_returns_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_return_items" ADD CONSTRAINT "rental_return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "rental_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_return_items" ADD CONSTRAINT "rental_return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

