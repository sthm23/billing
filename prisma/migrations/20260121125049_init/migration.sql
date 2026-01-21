/*
  Warnings:

  - You are about to drop the column `lastLoginAt` on the `AuthAccount` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Attribute` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name]` on the table `Category` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[storeId,barCode]` on the table `ProductVariant` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "AuthAccount" DROP COLUMN "lastLoginAt";

-- CreateTable
CREATE TABLE "CategoryAttribute" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,

    CONSTRAINT "CategoryAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryAttribute_categoryId_attributeId_key" ON "CategoryAttribute"("categoryId", "attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "Attribute_name_key" ON "Attribute"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_storeId_barCode_key" ON "ProductVariant"("storeId", "barCode");

-- AddForeignKey
ALTER TABLE "CategoryAttribute" ADD CONSTRAINT "CategoryAttribute_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAttribute" ADD CONSTRAINT "CategoryAttribute_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
