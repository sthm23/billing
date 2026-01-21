-- AlterTable
ALTER TABLE "CategoryAttribute" ADD CONSTRAINT "CategoryAttribute_pkey" PRIMARY KEY ("categoryId", "attributeId");

-- DropIndex
DROP INDEX "CategoryAttribute_categoryId_attributeId_key";

-- CreateIndex
CREATE INDEX "CategoryAttribute_attributeId_idx" ON "CategoryAttribute"("attributeId");
