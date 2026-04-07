/*
  Warnings:

  - You are about to drop the column `orderItemId` on the `ReturnItem` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[itemId]` on the table `ReturnItem` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `itemId` to the `ReturnItem` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ReturnItem" DROP CONSTRAINT "ReturnItem_orderItemId_fkey";

-- DropIndex
DROP INDEX "ReturnItem_orderItemId_key";

-- AlterTable
ALTER TABLE "ReturnItem" DROP COLUMN "orderItemId",
ADD COLUMN     "itemId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ReturnItem_itemId_key" ON "ReturnItem"("itemId");

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
