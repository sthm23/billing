-- Product photos move to Uztelecom Object Storage; the DB stores the object key, not a full URL.
-- Existing rows point to the old AWS bucket (prod has none) and are dropped on purpose.
DELETE FROM "product_images";

ALTER TABLE "product_images" RENAME COLUMN "url" TO "key";
