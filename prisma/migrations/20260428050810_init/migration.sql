/*
  Warnings:

  - A unique constraint covering the columns `[barCode]` on the table `product_variants` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "product_variants_storeId_barCode_key";

-- AlterTable
ALTER TABLE "BarcodeSequence" ALTER COLUMN "nextCode" SET DEFAULT 200000000000;

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_barCode_key" ON "product_variants"("barCode");
