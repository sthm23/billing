/*
  Warnings:

  - You are about to drop the column `values` on the `tags` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tags" DROP COLUMN "values";

-- CreateTable
CREATE TABLE "tag_values" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "tag_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_tag_values" (
    "variantId" TEXT NOT NULL,
    "tagValueId" TEXT NOT NULL,

    CONSTRAINT "variant_tag_values_pkey" PRIMARY KEY ("variantId","tagValueId")
);

-- CreateIndex
CREATE UNIQUE INDEX "tag_values_tagId_value_key" ON "tag_values"("tagId", "value");

-- AddForeignKey
ALTER TABLE "tag_values" ADD CONSTRAINT "tag_values_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_tag_values" ADD CONSTRAINT "variant_tag_values_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_tag_values" ADD CONSTRAINT "variant_tag_values_tagValueId_fkey" FOREIGN KEY ("tagValueId") REFERENCES "tag_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
