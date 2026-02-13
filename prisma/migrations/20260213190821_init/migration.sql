-- DropForeignKey
ALTER TABLE "staff" DROP CONSTRAINT "staff_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "stores" DROP CONSTRAINT "stores_createdBy_fkey";

-- AlterTable
ALTER TABLE "staff" ALTER COLUMN "warehouseId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
