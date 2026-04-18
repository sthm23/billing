/*
  Warnings:

  - You are about to drop the column `orderId` on the `additional_services` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "additional_services" DROP CONSTRAINT "additional_services_orderId_fkey";

-- DropIndex
DROP INDEX "additional_services_orderId_idx";

-- AlterTable
ALTER TABLE "additional_services" DROP COLUMN "orderId";

-- CreateTable
CREATE TABLE "additional_services_on_orders" (
    "orderId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "additional_services_on_orders_pkey" PRIMARY KEY ("orderId","serviceId")
);

-- AddForeignKey
ALTER TABLE "additional_services_on_orders" ADD CONSTRAINT "additional_services_on_orders_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "additional_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_services_on_orders" ADD CONSTRAINT "additional_services_on_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
