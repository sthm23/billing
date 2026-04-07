/*
  Warnings:

  - You are about to drop the `deliveries` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `status` to the `ReturnedOrder` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ReturnOrderStatus" AS ENUM ('DEBT', 'CREDIT', 'COMPLETED');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';

-- DropForeignKey
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_orderId_fkey";

-- AlterTable
ALTER TABLE "ReturnedOrder" ADD COLUMN     "status" "ReturnOrderStatus" NOT NULL,
ADD COLUMN     "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "isReturned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "returnedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "deliveries";
