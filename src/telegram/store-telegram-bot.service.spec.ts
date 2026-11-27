import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import type { CurrentUser } from '@auth/models/auth.model';
import type { PrismaService } from '@prisma/prisma.service';
import { ConnectBotDto } from './dto/telegram-bot.dto';
import { StoreTelegramBotService } from './store-telegram-bot.service';
import { TelegramApiError, TelegramBotClient } from './telegram-bot.client';
import { TelegramConfig } from './telegram.config';
import {
  NOTIFY_CHAT_NOT_CONNECTED,
  TELEGRAM_SHOP_DISABLED,
} from './telegram.constants';
import { TokenCryptoService } from './token-crypto.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const OTHER_STORE = '22222222-2222-4222-8222-222222222222';
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const ENV: Record<string, string> = {
  TELEGRAM_TOKEN_KEY: 'c'.repeat(64),
  TELEGRAM_WEBHOOK_BASE_URL: 'https://sthm23.uz',
  TELEGRAM_MINIAPP_URL: 'https://shop.sthm23.uz',
};

const owner = {
  id: 'owner-user',
  role: UserRole.OWNER,
  type: UserType.STAFF,
  staff: { id: 'staff-1', storeId: STORE, role: StaffRole.OWNER },
} as unknown as CurrentUser;

const admin = {
  id: 'admin-user',
  role: UserRole.ADMIN,
  type: UserType.STAFF,
  staff: null,
} as unknown as CurrentUser;

function dto(overrides: Partial<ConnectBotDto> = {}): ConnectBotDto {
  return Object.assign(new ConnectBotDto(), {
    token: TOKEN,
    slug: 'baraka_888',
    ...overrides,
  });
}

describe('StoreTelegramBotService', () => {
  let prisma: {
    store: { findUnique: jest.Mock };
    storeTelegramBot: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
  };
  let client: jest.Mocked<
    Pick<
      TelegramBotClient,
      | 'getMe'
      | 'setWebhook'
      | 'deleteWebhook'
      | 'setMenuButton'
      | 'resetMenuButton'
      | 'sendMessage'
    >
  >;
  let crypto: TokenCryptoService;
  let service: StoreTelegramBotService;

  const build = (env: Record<string, string | undefined> = ENV) => {
    const config = new TelegramConfig({
      get: (n: string) => env[n],
    } as unknown as ConfigService);
    crypto = new TokenCryptoService(config);

    return new StoreTelegramBotService(
      prisma as unknown as PrismaService,
      client as unknown as TelegramBotClient,
      crypto,
      config,
      { info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
    );
  };

  const savedRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'bot-1',
    storeId: STORE,
    slug: 'baraka_888',
    botTokenEnc: crypto.encrypt(TOKEN),
    botId: '123456789',
    botUsername: 'baraka_888_bot',
    webhookSecret: 'secret',
    notifyChatId: null,
    isActive: true,
    createdAt: new Date('2026-11-27T10:00:00Z'),
    updatedAt: new Date('2026-11-27T10:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: STORE,
            name: 'Baraka',
            telegramShopEnabled: true,
          }),
      },
      storeTelegramBot: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    client = {
      getMe: jest
        .fn()
        .mockResolvedValue({
          id: 123456789,
          username: 'baraka_888_bot',
          isBot: true,
        }),
      setWebhook: jest.fn().mockResolvedValue(undefined),
      deleteWebhook: jest.fn().mockResolvedValue(undefined),
      setMenuButton: jest.fn().mockResolvedValue(undefined),
      resetMenuButton: jest.fn().mockResolvedValue(undefined),
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };
    service = build();
    prisma.storeTelegramBot.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve(savedRow(create)),
    );
  });

  describe('connect', () => {
    it('checks the token, sets the webhook and the menu button, stores the token encrypted', async () => {
      const view = await service.connect(dto(), owner);

      expect(client.getMe).toHaveBeenCalledWith(TOKEN);
      expect(client.setWebhook).toHaveBeenCalledWith(
        TOKEN,
        'https://sthm23.uz/api/telegram-shop/webhook/baraka_888',
        expect.stringMatching(/^[0-9a-f]{48}$/) as unknown as string,
      );
      expect(client.setMenuButton).toHaveBeenCalledWith(
        TOKEN,
        'Магазин',
        'https://shop.sthm23.uz/baraka_888',
      );

      const { create } = prisma.storeTelegramBot.upsert.mock.calls[0][0] as {
        create: Record<string, string>;
      };
      expect(create).toMatchObject({
        storeId: STORE,
        slug: 'baraka_888',
        botId: '123456789',
        botUsername: 'baraka_888_bot',
        isActive: true,
        notifyChatId: null,
      });
      expect(create.botTokenEnc).not.toContain(TOKEN);
      expect(crypto.decrypt(create.botTokenEnc)).toBe(TOKEN);
      // the secret Telegram will send back is the one stored
      expect(create.webhookSecret).toBe(client.setWebhook.mock.calls[0][2]);

      expect(view).toMatchObject({
        slug: 'baraka_888',
        botLink: 'https://t.me/baraka_888_bot',
        miniAppUrl: 'https://shop.sthm23.uz/baraka_888',
        notifyConnected: false,
      });
    });

    it('never returns the token, its ciphertext or the webhook secret', async () => {
      const view = await service.connect(dto(), owner);
      const json = JSON.stringify(view);

      expect(json).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
      expect(json).not.toContain('botTokenEnc');
      expect(json).not.toContain('webhookSecret');
      expect(json).not.toContain('v1:');
    });

    it('takes the store from the token, ignoring a storeId sent by an owner', async () => {
      await service.connect(dto({ storeId: OTHER_STORE }), owner);

      expect(prisma.store.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: STORE } }),
      );
      expect(prisma.storeTelegramBot.upsert.mock.calls[0][0]).toMatchObject({
        where: { storeId: STORE },
      });
    });

    it('lets a platform ADMIN connect a named store, and requires the storeId', async () => {
      prisma.store.findUnique.mockResolvedValue({
        id: OTHER_STORE,
        name: 'Other',
        telegramShopEnabled: true,
      });

      await service.connect(dto({ storeId: OTHER_STORE }), admin);
      expect(prisma.storeTelegramBot.upsert.mock.calls[0][0]).toMatchObject({
        where: { storeId: OTHER_STORE },
      });

      await expect(service.connect(dto(), admin)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses with 403 when the paid service is off, before calling Telegram', async () => {
      prisma.store.findUnique.mockResolvedValue({
        id: STORE,
        name: 'Baraka',
        telegramShopEnabled: false,
      });

      await expect(service.connect(dto(), owner)).rejects.toMatchObject({
        response: { code: TELEGRAM_SHOP_DISABLED },
      });
      expect(client.getMe).not.toHaveBeenCalled();
      expect(prisma.storeTelegramBot.upsert).not.toHaveBeenCalled();
    });

    it('answers 503 when the server has no Telegram settings', async () => {
      service = build({});

      await expect(service.connect(dto(), owner)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(client.getMe).not.toHaveBeenCalled();
    });

    it('rejects a wrong token with 400 and stores nothing', async () => {
      client.getMe.mockRejectedValue(new TelegramApiError(401, 'Unauthorized'));

      await expect(service.connect(dto(), owner)).rejects.toThrow(
        'Invalid bot token',
      );
      expect(client.setWebhook).not.toHaveBeenCalled();
      expect(prisma.storeTelegramBot.upsert).not.toHaveBeenCalled();
    });

    it('rejects a token that is not a bot', async () => {
      client.getMe.mockResolvedValue({
        id: 1,
        username: 'someone',
        isBot: false,
      });

      await expect(service.connect(dto(), owner)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an address taken by another store, before calling Telegram', async () => {
      prisma.storeTelegramBot.findUnique.mockImplementation(
        ({ where }: { where: { slug?: string; storeId?: string } }) =>
          Promise.resolve(where.slug ? { storeId: OTHER_STORE } : null),
      );

      await expect(service.connect(dto(), owner)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(client.getMe).not.toHaveBeenCalled();
    });

    it('rejects a bot that already serves another store', async () => {
      prisma.storeTelegramBot.findFirst.mockResolvedValue({ id: 'other-bot' });

      await expect(service.connect(dto(), owner)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(client.setWebhook).not.toHaveBeenCalled();
    });

    it('turns a Telegram refusal (e.g. an HTTP webhook address) into 400 with its reason', async () => {
      client.setWebhook.mockRejectedValue(
        new TelegramApiError(
          400,
          'Bad Request: bad webhook: HTTPS url must be provided',
        ),
      );

      await expect(service.connect(dto(), owner)).rejects.toThrow(
        'Telegram: Bad Request: bad webhook: HTTPS url must be provided',
      );
      expect(prisma.storeTelegramBot.upsert).not.toHaveBeenCalled();
    });

    it('does not hide a Telegram outage as a bad request', async () => {
      client.getMe.mockRejectedValue(new ServiceUnavailableException());

      await expect(service.connect(dto(), owner)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('reconnecting the same bot keeps the notification chat', async () => {
      prisma.storeTelegramBot.findUnique.mockImplementation(
        ({ where }: { where: { storeId?: string } }) =>
          Promise.resolve(
            where.storeId ? savedRow({ notifyChatId: '555' }) : null,
          ),
      );

      await service.connect(dto(), owner);

      const { update } = prisma.storeTelegramBot.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(update.notifyChatId).toBe('555');
      expect(client.deleteWebhook).not.toHaveBeenCalled();
    });

    it('replacing the bot releases the old one and forgets the notification chat', async () => {
      const oldToken = '987654321:ZZZdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
      prisma.storeTelegramBot.findUnique.mockImplementation(
        ({ where }: { where: { storeId?: string } }) =>
          Promise.resolve(
            where.storeId
              ? savedRow({
                  botId: '987654321',
                  botTokenEnc: crypto.encrypt(oldToken),
                  notifyChatId: '555',
                })
              : null,
          ),
      );

      await service.connect(dto(), owner);

      expect(client.deleteWebhook).toHaveBeenCalledWith(oldToken);
      expect(client.resetMenuButton).toHaveBeenCalledWith(oldToken);
      const { update } = prisma.storeTelegramBot.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(update.notifyChatId).toBeNull();
    });

    it('a duplicate address lost in a race becomes 409', async () => {
      prisma.storeTelegramBot.upsert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.connect(dto(), owner)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('getState', () => {
    it('shows the service flag, server settings and no bot yet', async () => {
      await expect(service.getState(owner)).resolves.toEqual({
        enabled: true,
        configured: true,
        bot: null,
      });
    });

    it('shows the connected bot without secrets; no Mini App address while the server is not configured', async () => {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(
        savedRow({ notifyChatId: '555' }),
      );
      service = build({});

      const state = await service.getState(owner);

      expect(state.configured).toBe(false);
      expect(state.bot).toMatchObject({
        miniAppUrl: null,
        notifyConnected: true,
      });
      expect(JSON.stringify(state)).not.toContain('botTokenEnc');
    });

    it('404 for an unknown store (admin)', async () => {
      prisma.store.findUnique.mockResolvedValue(null);

      await expect(service.getState(admin, OTHER_STORE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('disconnect', () => {
    it('takes the webhook and the menu button back and deletes the row', async () => {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(savedRow());

      await expect(service.disconnect(owner)).resolves.toEqual({
        disconnected: true,
      });

      expect(client.deleteWebhook).toHaveBeenCalledWith(TOKEN);
      expect(client.resetMenuButton).toHaveBeenCalledWith(TOKEN);
      expect(prisma.storeTelegramBot.delete).toHaveBeenCalledWith({
        where: { id: 'bot-1' },
      });
    });

    it('still deletes when Telegram no longer accepts the token (revoked)', async () => {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(savedRow());
      client.deleteWebhook.mockRejectedValue(
        new TelegramApiError(401, 'Unauthorized'),
      );

      await service.disconnect(owner);

      expect(prisma.storeTelegramBot.delete).toHaveBeenCalled();
    });

    it('works while the paid service is off', async () => {
      prisma.store.findUnique.mockResolvedValue({
        id: STORE,
        name: 'Baraka',
        telegramShopEnabled: false,
      });
      prisma.storeTelegramBot.findUnique.mockResolvedValue(savedRow());

      await expect(service.disconnect(owner)).resolves.toEqual({
        disconnected: true,
      });
    });

    it('404 when no bot is connected', async () => {
      await expect(service.disconnect(owner)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createNotifyLink', () => {
    it('returns a private and a group link with a code the webhook accepts', async () => {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(savedRow());

      const { link, groupLink, expiresAt } =
        await service.createNotifyLink(owner);

      const code = /\?start=(\S+)$/.exec(link)?.[1] ?? '';
      expect(link.startsWith('https://t.me/baraka_888_bot?start=n')).toBe(true);
      expect(groupLink).toBe(`https://t.me/baraka_888_bot?startgroup=${code}`);
      expect(crypto.verifyNotifyCode('baraka_888', code)).toBe(true);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('404 when no bot is connected', async () => {
      await expect(service.createNotifyLink(owner)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('sendTest', () => {
    it('writes to the notification chat with the stored token', async () => {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(
        savedRow({ notifyChatId: '555' }),
      );

      await expect(service.sendTest(owner)).resolves.toEqual({ sent: true });

      expect(client.sendMessage).toHaveBeenCalledWith(
        TOKEN,
        '555',
        expect.stringContaining('Baraka') as unknown as string,
      );
    });

    it('asks to press the link first when no chat is connected', async () => {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(savedRow());

      await expect(service.sendTest(owner)).rejects.toMatchObject({
        response: { code: NOTIFY_CHAT_NOT_CONNECTED },
      });
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('shows why Telegram refused (the bot was removed from the group)', async () => {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(
        savedRow({ notifyChatId: '555' }),
      );
      client.sendMessage.mockRejectedValue(
        new TelegramApiError(403, 'bot was kicked'),
      );

      await expect(service.sendTest(owner)).rejects.toThrow(
        'Telegram: bot was kicked',
      );
    });
  });

  it('a user without a store and without the ADMIN role gets 403', async () => {
    const stranger = {
      id: 'u',
      role: UserRole.USER,
      staff: null,
    } as unknown as CurrentUser;

    await expect(service.getState(stranger)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
