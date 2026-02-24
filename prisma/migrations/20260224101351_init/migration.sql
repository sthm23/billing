/*
  Warnings:

  - You are about to drop the `products_on_tags` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `variant_tag_values` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "products_on_tags" DROP CONSTRAINT "products_on_tags_productId_fkey";

-- DropForeignKey
ALTER TABLE "products_on_tags" DROP CONSTRAINT "products_on_tags_tagId_fkey";

-- DropForeignKey
ALTER TABLE "variant_tag_values" DROP CONSTRAINT "variant_tag_values_tagValueId_fkey";

-- DropForeignKey
ALTER TABLE "variant_tag_values" DROP CONSTRAINT "variant_tag_values_variantId_fkey";

-- DropTable
DROP TABLE "products_on_tags";

-- DropTable
DROP TABLE "variant_tag_values";

-- CreateTable
CREATE TABLE "product_tag_values" (
    "productId" TEXT NOT NULL,
    "tagValueId" TEXT NOT NULL,

    CONSTRAINT "product_tag_values_pkey" PRIMARY KEY ("productId","tagValueId")
);

-- AddForeignKey
ALTER TABLE "product_tag_values" ADD CONSTRAINT "product_tag_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tag_values" ADD CONSTRAINT "product_tag_values_tagValueId_fkey" FOREIGN KEY ("tagValueId") REFERENCES "tag_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
