import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { UserModule } from '../user/user.module';
import { OnlineOrderService } from './online-order.service';
import { OnlineOrdersController } from './online-orders.controller';
import { PublicShopController } from './public-shop.controller';
import { PublicShopService } from './public-shop.service';
import { StoreTelegramBotService } from './store-telegram-bot.service';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramConfig } from './telegram.config';
import { TelegramShopGuard } from './telegram-shop.guard';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TokenCryptoService } from './token-crypto.service';

/** Telegram shop: the store's own bot (docs/telegram-shop/PLAN.md). */
@Module({
  imports: [OrderModule, UserModule],
  controllers: [
    TelegramBotController,
    TelegramWebhookController,
    PublicShopController,
    OnlineOrdersController,
  ],
  providers: [
    TelegramConfig,
    TokenCryptoService,
    TelegramBotClient,
    StoreTelegramBotService,
    TelegramWebhookService,
    TelegramShopGuard,
    PublicShopService,
    OnlineOrderService,
  ],
  // Stages 3–4 send requests to the store and answers to customers through these
  exports: [TelegramBotClient, TokenCryptoService, TelegramConfig],
})
export class TelegramModule {}
