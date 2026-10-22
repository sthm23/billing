-- Time the cashbox (shift) was closed; null while open and for cashboxes closed before this column existed
ALTER TABLE "Cashbox" ADD COLUMN "closedAt" TIMESTAMP(3);

-- Time the order was sold (became COMPLETED or DEBT); null while CREATED/HOLD
ALTER TABLE "orders" ADD COLUMN "soldAt" TIMESTAMP(3);

-- Backfill sold orders: first payment, or creation time for a sale fully on credit (no payments)
UPDATE "orders" o
SET "soldAt" = COALESCE(
  (SELECT MIN(p."createdAt") FROM "payments" p WHERE p."orderId" = o."id"),
  o."createdAt"
)
WHERE o."status" IN ('COMPLETED', 'DEBT', 'REFUNDED');

CREATE INDEX "orders_storeId_soldAt_idx" ON "orders"("storeId", "soldAt");
