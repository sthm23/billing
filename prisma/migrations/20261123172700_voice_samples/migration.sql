-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "voiceDataConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "voiceDataConsentAt" TIMESTAMP(3),
ADD COLUMN     "voiceDataConsentById" TEXT;

-- CreateTable
CREATE TABLE "voice_samples" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "audioKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "model" TEXT,
    "transcript" TEXT NOT NULL,
    "transcriptFinal" TEXT,
    "choices" JSONB,
    "labeledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_samples_storeId_createdAt_idx" ON "voice_samples"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "voice_samples_createdAt_idx" ON "voice_samples"("createdAt");

-- AddForeignKey
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
