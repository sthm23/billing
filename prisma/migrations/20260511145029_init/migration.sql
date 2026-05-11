-- CreateEnum
CREATE TYPE "CashTransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CashTransactionCategory" AS ENUM ('SALE', 'DEBT_PAYMENT', 'RENT', 'DELIVERY', 'SALARY', 'PURCHASE', 'RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "CashStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "Cashbox" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "CashStatus" NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cashbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTransaction" (
    "id" TEXT NOT NULL,
    "cashboxId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "type" "CashTransactionType" NOT NULL,
    "category" "CashTransactionCategory" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "comment" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Cashbox" ADD CONSTRAINT "Cashbox_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cashbox" ADD CONSTRAINT "Cashbox_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_cashboxId_fkey" FOREIGN KEY ("cashboxId") REFERENCES "Cashbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
