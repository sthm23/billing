/*
  Warnings:

  - You are about to drop the `_CategoryAttributes` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_CategoryAttributes" DROP CONSTRAINT "_CategoryAttributes_A_fkey";

-- DropForeignKey
ALTER TABLE "_CategoryAttributes" DROP CONSTRAINT "_CategoryAttributes_B_fkey";

-- DropTable
DROP TABLE "_CategoryAttributes";

-- CreateTable
CREATE TABLE "CategoriesOnAttribute" (
    "attributeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "CategoriesOnAttribute_pkey" PRIMARY KEY ("attributeId","categoryId")
);

-- AddForeignKey
ALTER TABLE "CategoriesOnAttribute" ADD CONSTRAINT "CategoriesOnAttribute_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriesOnAttribute" ADD CONSTRAINT "CategoriesOnAttribute_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
