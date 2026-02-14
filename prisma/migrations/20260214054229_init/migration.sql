-- CreateTable
CREATE TABLE "categories_on_stores" (
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "categories_on_stores_pkey" PRIMARY KEY ("storeId","categoryId")
);

-- AddForeignKey
ALTER TABLE "categories_on_stores" ADD CONSTRAINT "categories_on_stores_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories_on_stores" ADD CONSTRAINT "categories_on_stores_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
