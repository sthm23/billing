import { Module } from '@nestjs/common';
import { StoreTelegramBotService } from './store-telegram-bot.service';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramConfig } from './telegram.config';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TokenCryptoService } from './token-crypto.service';

/** Telegram shop: the store's own bot (docs/telegram-shop/PLAN.md). */
@Module({
  controllers: [TelegramBotController, TelegramWebhookController],
  providers: [
    TelegramConfig,
    TokenCryptoService,
    TelegramBotClient,
    StoreTelegramBotService,
    TelegramWebhookService,
  ],
  // Stages 3–4 send requests to the store and answers to customers through these
  exports: [TelegramBotClient, TokenCryptoService, TelegramConfig],
})
export class TelegramModule {}
