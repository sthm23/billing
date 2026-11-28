-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('NEW', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "telegramShopEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "store_telegram_bots" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "botTokenEnc" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "botUsername" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "notifyChatId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_telegram_bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_orders" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "comment" TEXT,
    "status" "OnlineOrderStatus" NOT NULL DEFAULT 'NEW',
    "orderId" TEXT,
    "customerId" TEXT,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_order_items" (
    "id" TEXT NOT NULL,
    "onlineOrderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceAtRequest" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "online_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_telegram_bots_storeId_key" ON "store_telegram_bots"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "store_telegram_bots_slug_key" ON "store_telegram_bots"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_orderId_key" ON "online_orders"("orderId");

-- CreateIndex
CREATE INDEX "online_orders_storeId_status_createdAt_idx" ON "online_orders"("storeId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_storeId_number_key" ON "online_orders"("storeId", "number");

-- CreateIndex
CREATE INDEX "online_order_items_onlineOrderId_idx" ON "online_order_items"("onlineOrderId");

-- CreateIndex
CREATE INDEX "online_order_items_variantId_idx" ON "online_order_items"("variantId");

-- AddForeignKey
ALTER TABLE "store_telegram_bots" ADD CONSTRAINT "store_telegram_bots_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_onlineOrderId_fkey" FOREIGN KEY ("onlineOrderId") REFERENCES "online_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

