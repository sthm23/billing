import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { PrismaService } from '@prisma/prisma.service';
import { StoreTelegramBotService } from './store-telegram-bot.service';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TelegramModule } from './telegram.module';
import { TokenCryptoService } from './token-crypto.service';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

/** What the real app provides globally (PrismaModule, ConfigModule, LoggerModule). */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: ConfigService, useValue: { get: () => undefined } },
    ...[TelegramBotClient, StoreTelegramBotService, TelegramWebhookService].map(
      (c) => ({ provide: getLoggerToken(c.name), useValue: logger }),
    ),
  ],
  exports: [
    PrismaService,
    ConfigService,
    getLoggerToken(TelegramBotClient.name),
    getLoggerToken(StoreTelegramBotService.name),
    getLoggerToken(TelegramWebhookService.name),
  ],
})
class GlobalsStub {}

describe('TelegramModule', () => {
  it('wires every provider and both controllers', async () => {
    const module = await Test.createTestingModule({
      imports: [GlobalsStub, TelegramModule],
    }).compile();

    expect(module.get(TelegramBotController)).toBeDefined();
    expect(module.get(TelegramWebhookController)).toBeDefined();
    expect(module.get(StoreTelegramBotService)).toBeDefined();
    expect(module.get(TokenCryptoService)).toBeDefined();
  });
});
