/*
  Warnings:

  - You are about to drop the `additional_services_on_orders` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `additional_services_on_stores` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `orderId` to the `additional_services` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "additional_services_on_orders" DROP CONSTRAINT "additional_services_on_orders_orderId_fkey";

-- DropForeignKey
ALTER TABLE "additional_services_on_orders" DROP CONSTRAINT "additional_services_on_orders_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "additional_services_on_stores" DROP CONSTRAINT "additional_services_on_stores_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "additional_services_on_stores" DROP CONSTRAINT "additional_services_on_stores_storeId_fkey";

-- AlterTable
ALTER TABLE "additional_services" ADD COLUMN     "orderId" TEXT NOT NULL;

-- DropTable
DROP TABLE "additional_services_on_orders";

-- DropTable
DROP TABLE "additional_services_on_stores";

-- CreateIndex
CREATE INDEX "additional_services_orderId_idx" ON "additional_services"("orderId");

-- AddForeignKey
ALTER TABLE "additional_services" ADD CONSTRAINT "additional_services_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
