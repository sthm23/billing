-- CreateTable
CREATE TABLE "brands_on_stores" (
    "storeId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,

    CONSTRAINT "brands_on_stores_pkey" PRIMARY KEY ("storeId","brandId")
);

-- AddForeignKey
ALTER TABLE "brands_on_stores" ADD CONSTRAINT "brands_on_stores_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands_on_stores" ADD CONSTRAINT "brands_on_stores_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
