-- DropIndex
DROP INDEX "warehouses_storeId_key";

-- CreateIndex
CREATE INDEX "warehouses_storeId_idx" ON "warehouses"("storeId");
