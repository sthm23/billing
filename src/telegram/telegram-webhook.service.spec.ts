import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { StoreStatus } from '@generated/enums';
import type { PrismaService } from '@prisma/prisma.service';
import type { TelegramBotClient } from './telegram-bot.client';
import { TelegramConfig } from './telegram.config';
import { BOT_TEXTS } from './telegram.constants';
import {
  type TelegramUpdate,
  TelegramWebhookService,
} from './telegram-webhook.service';
import { TokenCryptoService } from './token-crypto.service';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const SLUG = 'baraka_888';
const SECRET = 'webhook-secret';
const ENV: Record<string, string> = {
  TELEGRAM_TOKEN_KEY: 'd'.repeat(64),
  TELEGRAM_WEBHOOK_BASE_URL: 'https://sthm23.uz',
  TELEGRAM_MINIAPP_URL: 'https://shop.sthm23.uz',
};

describe('TelegramWebhookService', () => {
  let prisma: {
    storeTelegramBot: { findUnique: jest.Mock; update: jest.Mock };
  };
  let client: { sendMessage: jest.Mock };
  let crypto: TokenCryptoService;
  let service: TelegramWebhookService;
  let logger: { info: jest.Mock; warn: jest.Mock };

  const botRow = (
    bot: Record<string, unknown> = {},
    store: Record<string, unknown> = {},
  ) => ({
    id: 'bot-1',
    storeId: 'store-1',
    slug: SLUG,
    botTokenEnc: crypto.encrypt(TOKEN),
    webhookSecret: SECRET,
    isActive: true,
    store: {
      name: 'Baraka',
      telegramShopEnabled: true,
      status: StoreStatus.ACTIVE,
      ...store,
    },
    ...bot,
  });

  const start = (
    text: string,
    chat: { id?: number; type?: string } = { id: 777, type: 'private' },
    languageCode?: string,
  ): TelegramUpdate => ({
    message: { text, chat, from: { language_code: languageCode } },
  });

  beforeEach(() => {
    const config = new TelegramConfig({
      get: (n: string) => ENV[n],
    } as unknown as ConfigService);
    crypto = new TokenCryptoService(config);
    prisma = {
      storeTelegramBot: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(botRow())),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    client = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    logger = { info: jest.fn(), warn: jest.fn() };
    service = new TelegramWebhookService(
      prisma as unknown as PrismaService,
      client as unknown as TelegramBotClient,
      crypto,
      config,
      logger as unknown as PinoLogger,
    );
  });

  describe('who may call', () => {
    it('404 for an unknown or malformed address, without touching the database for junk', async () => {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(null);

      await expect(
        service.handleUpdate(SLUG, SECRET, start('/start')),
      ).rejects.toBeInstanceOf(NotFoundException);
      prisma.storeTelegramBot.findUnique.mockClear();
      await expect(
        service.handleUpdate('../etc/passwd', SECRET, start('/start')),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storeTelegramBot.findUnique).not.toHaveBeenCalled();
    });

    it('403 without the secret header, with a wrong one, or with one of another length', async () => {
      for (const secret of [undefined, '', 'wrong-secret!', 'x']) {
        await expect(
          service.handleUpdate(SLUG, secret, start('/start')),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(client.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('/start', () => {
    it('greets in a private chat with a button that opens this shop', async () => {
      await expect(
        service.handleUpdate(SLUG, SECRET, start('/start')),
      ).resolves.toEqual({
        ok: true,
      });

      expect(client.sendMessage).toHaveBeenCalledWith(
        TOKEN,
        777,
        BOT_TEXTS.ru.greeting('Baraka'),
        {
          text: BOT_TEXTS.ru.openShop,
          url: 'https://shop.sthm23.uz/baraka_888',
        },
      );
    });

    it('answers in Uzbek to an Uzbek Telegram', async () => {
      await service.handleUpdate(
        SLUG,
        SECRET,
        start('/start', undefined, 'uz'),
      );

      expect(client.sendMessage.mock.calls[0][2]).toBe(
        BOT_TEXTS.uz.greeting('Baraka'),
      );
    });

    it('sends no Mini App button into a group (Telegram allows it in private chats only)', async () => {
      await service.handleUpdate(
        SLUG,
        SECRET,
        start('/start', { id: -100, type: 'supergroup' }),
      );

      expect(client.sendMessage.mock.calls[0][3]).toBeUndefined();
    });

    it('understands /start@bot and a deep-link payload that is not a notify code', async () => {
      await service.handleUpdate(SLUG, SECRET, start('/start@baraka_888_bot'));
      await service.handleUpdate(SLUG, SECRET, start('/start promo123'));

      expect(client.sendMessage).toHaveBeenCalledTimes(2);
      expect(prisma.storeTelegramBot.update).not.toHaveBeenCalled();
    });

    it('ignores other messages and updates without a text or a chat', async () => {
      await service.handleUpdate(SLUG, SECRET, start('hello'));
      await service.handleUpdate(SLUG, SECRET, start('/startup'));
      await service.handleUpdate(SLUG, SECRET, {});
      await service.handleUpdate(SLUG, SECRET, { message: { text: '/start' } });

      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('stays silent for a switched-off service, a suspended store or an inactive bot', async () => {
      const cases = [
        botRow({}, { telegramShopEnabled: false }),
        botRow({}, { status: StoreStatus.SUSPENDED }),
        botRow({ isActive: false }),
      ];
      for (const row of cases) {
        prisma.storeTelegramBot.findUnique.mockResolvedValue(row);
        await expect(
          service.handleUpdate(SLUG, SECRET, start('/start')),
        ).resolves.toEqual({
          ok: true,
        });
      }

      expect(client.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('notification chat', () => {
    it('a valid code saves the chat and confirms', async () => {
      const { code } = crypto.signNotifyCode(SLUG);

      await service.handleUpdate(
        SLUG,
        SECRET,
        start(`/start ${code}`, { id: -555, type: 'group' }),
      );

      expect(prisma.storeTelegramBot.update).toHaveBeenCalledWith({
        where: { id: 'bot-1' },
        data: { notifyChatId: '-555' },
      });
      expect(client.sendMessage).toHaveBeenCalledWith(
        TOKEN,
        -555,
        BOT_TEXTS.ru.notifyConnected,
      );
    });

    it('an expired, forged or foreign code saves nothing and says so', async () => {
      const expired = crypto.signNotifyCode(SLUG, Date.now() - 3_600_000).code;
      const foreign = crypto.signNotifyCode('other_shop').code;

      for (const code of [
        expired,
        foreign,
        'nzzzzzz_000000000000000000000000',
      ]) {
        await service.handleUpdate(SLUG, SECRET, start(`/start ${code}`));
      }

      expect(prisma.storeTelegramBot.update).not.toHaveBeenCalled();
      expect(client.sendMessage).toHaveBeenCalledTimes(3);
      for (const call of client.sendMessage.mock.calls) {
        expect(call[2]).toBe(BOT_TEXTS.ru.notifyExpired);
      }
    });
  });

  it('answers ok even when Telegram refuses the reply, and logs without the token', async () => {
    client.sendMessage.mockRejectedValue(new Error(`blocked ${TOKEN}`));

    await expect(
      service.handleUpdate(SLUG, SECRET, start('/start')),
    ).resolves.toEqual({
      ok: true,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('answers ok when the stored token cannot be decrypted (key changed)', async () => {
    prisma.storeTelegramBot.findUnique.mockResolvedValue(
      botRow({ botTokenEnc: 'v1:bad:bad:bad' }),
    );

    await expect(
      service.handleUpdate(SLUG, SECRET, start('/start')),
    ).resolves.toEqual({
      ok: true,
    });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
});
