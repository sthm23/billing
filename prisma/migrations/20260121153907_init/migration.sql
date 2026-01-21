/*
  Warnings:

  - You are about to drop the `CategoryAttribute` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CategoryAttribute" DROP CONSTRAINT "CategoryAttribute_attributeId_fkey";

-- DropForeignKey
ALTER TABLE "CategoryAttribute" DROP CONSTRAINT "CategoryAttribute_categoryId_fkey";

-- DropTable
DROP TABLE "CategoryAttribute";

-- CreateTable
CREATE TABLE "_CategoryAttributes" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CategoryAttributes_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CategoryAttributes_B_index" ON "_CategoryAttributes"("B");

-- AddForeignKey
ALTER TABLE "_CategoryAttributes" ADD CONSTRAINT "_CategoryAttributes_A_fkey" FOREIGN KEY ("A") REFERENCES "Attribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryAttributes" ADD CONSTRAINT "_CategoryAttributes_B_fkey" FOREIGN KEY ("B") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
