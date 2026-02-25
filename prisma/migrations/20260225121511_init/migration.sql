/*
  Warnings:

  - Made the column `cashierId` on table `orders` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_cashierId_fkey";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ALTER COLUMN "cashierId" SET NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
