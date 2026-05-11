/*
  Warnings:

  - Added the required column `paymentType` to the `CashTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CashTransaction" ADD COLUMN     "paymentType" "PaymentType" NOT NULL;
