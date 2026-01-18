/*
  Warnings:

  - The values [OWNER] on the enum `StaffRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `Admin` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OWNER', 'USER');

-- AlterEnum
BEGIN;
CREATE TYPE "StaffRole_new" AS ENUM ('SELLER', 'MANAGER', 'CASHIER', 'WAREHOUSE');
ALTER TABLE "Staff" ALTER COLUMN "role" TYPE "StaffRole_new" USING ("role"::text::"StaffRole_new");
ALTER TYPE "StaffRole" RENAME TO "StaffRole_old";
ALTER TYPE "StaffRole_new" RENAME TO "StaffRole";
DROP TYPE "public"."StaffRole_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_userId_fkey";

-- DropForeignKey
ALTER TABLE "Store" DROP CONSTRAINT "Store_createdBy_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- DropTable
DROP TABLE "Admin";

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "AuthAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
