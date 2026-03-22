/*
  Warnings:

  - You are about to drop the column `storeId` on the `products` table. All the data in the column will be lost.
  - Added the required column `warehouseId` to the `products` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_storeId_fkey";

-- DropIndex
DROP INDEX "products_storeId_idx";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "storeId",
ADD COLUMN     "warehouseId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "products_warehouseId_idx" ON "products"("warehouseId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
