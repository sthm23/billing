import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getLoggerToken } from 'nestjs-pino';
import { authThrottleOptions } from '@auth/auth-throttle';
import { PrismaService } from '@prisma/prisma.service';
import { OrderService } from '@order/order.service';
import { UserService } from '@user/user.service';
import { OnlineOrderService } from './online-order.service';
import { PublicShopController } from './public-shop.controller';
import { PublicShopService } from './public-shop.service';
import { StoreTelegramBotService } from './store-telegram-bot.service';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramShopGuard } from './telegram-shop.guard';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TelegramModule } from './telegram.module';
import { TokenCryptoService } from './token-crypto.service';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const LOGGED = [
  TelegramBotClient,
  StoreTelegramBotService,
  TelegramWebhookService,
  TelegramShopGuard,
  PublicShopService,
  OnlineOrderService,
  OrderService,
  UserService,
];

/** What the real app provides globally (PrismaModule, ConfigModule, LoggerModule). */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: ConfigService, useValue: { get: () => undefined } },
    ...LOGGED.map((c) => ({
      provide: getLoggerToken(c.name),
      useValue: logger,
    })),
  ],
  exports: [
    PrismaService,
    ConfigService,
    ...LOGGED.map((c) => getLoggerToken(c.name)),
  ],
})
class GlobalsStub {}

describe('TelegramModule', () => {
  it('wires every provider, the guard and all three controllers', async () => {
    const module = await Test.createTestingModule({
      // ThrottlerModule is global in the app (AuthModule registers it)
      imports: [
        ThrottlerModule.forRoot(authThrottleOptions),
        GlobalsStub,
        TelegramModule,
      ],
    }).compile();

    expect(module.get(TelegramBotController)).toBeDefined();
    expect(module.get(TelegramWebhookController)).toBeDefined();
    expect(module.get(PublicShopController)).toBeDefined();
    expect(module.get(PublicShopService)).toBeDefined();
    expect(module.get(TelegramShopGuard)).toBeDefined();
    expect(module.get(TokenCryptoService)).toBeDefined();
  });
});
