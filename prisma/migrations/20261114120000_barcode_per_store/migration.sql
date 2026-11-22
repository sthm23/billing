-- Barcode is unique per store (manual factory codes allowed), not globally
DROP INDEX "product_variants_barCode_key";

CREATE UNIQUE INDEX "product_variants_storeId_barCode_key" ON "product_variants"("storeId", "barCode");
