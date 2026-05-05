-- CreateTable
CREATE TABLE "BarcodeSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nextCode" BIGINT NOT NULL DEFAULT 2000000000001,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BarcodeSequence_pkey" PRIMARY KEY ("id")
);
