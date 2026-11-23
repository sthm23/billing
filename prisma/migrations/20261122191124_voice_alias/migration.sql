-- CreateTable
CREATE TABLE "voice_aliases" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_aliases_storeId_phrase_variantId_key" ON "voice_aliases"("storeId", "phrase", "variantId");

-- AddForeignKey
ALTER TABLE "voice_aliases" ADD CONSTRAINT "voice_aliases_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_aliases" ADD CONSTRAINT "voice_aliases_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_aliases" ADD CONSTRAINT "voice_aliases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
