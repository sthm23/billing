/*
  Warnings:

  - Made the column `login` on table `AuthAccount` required. This step will fail if there are existing NULL values in that column.
  - Made the column `phone` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "AuthAccount" ALTER COLUMN "login" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL;
