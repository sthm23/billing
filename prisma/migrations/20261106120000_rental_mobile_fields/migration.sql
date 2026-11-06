-- Rental phase 6.0: suggested dry-cleaning days per variant, issue without collateral
ALTER TABLE "product_variants" ADD COLUMN "defaultCleaningDays" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "rentals" ADD COLUMN "issuedWithoutCollateral" BOOLEAN NOT NULL DEFAULT false;
