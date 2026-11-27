import { createHmac } from 'node:crypto';
import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { StoreStatus } from '@generated/enums';
import type { PrismaService } from '@prisma/prisma.service';
import type { ShopRequest } from './shop-context';
import { TelegramConfig } from './telegram.config';
import { SHOP_UNAVAILABLE } from './telegram.constants';
import { TelegramShopGuard } from './telegram-shop.guard';
import { TokenCryptoService } from './token-crypto.service';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const OTHER_TOKEN = '987654321:ZZZdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

function initData(token: string, userId = 4242, ageSec = 60): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000) - ageSec),
    user: JSON.stringify({ id: userId, language_code: 'ru' }),
  };
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  return new URLSearchParams({ ...fields, hash }).toString();
}

describe('TelegramShopGuard', () => {
  let prisma: { storeTelegramBot: { findUnique: jest.Mock } };
  let crypto: TokenCryptoService;
  let guard: TelegramShopGuard;
  let logger: { error: jest.Mock };

  const botRow = (
    bot: Record<string, unknown> = {},
    store: Record<string, unknown> = {},
  ) => ({
    slug: 'baraka_888',
    botTokenEnc: crypto.encrypt(TOKEN),
    notifyChatId: '555',
    isActive: true,
    store: {
      id: 'store-1',
      name: 'Baraka',
      telegramShopEnabled: true,
      status: StoreStatus.ACTIVE,
      ...store,
    },
    ...bot,
  });

  const call = (headers: Record<string, string>, slug = 'baraka_888') => {
    const request: ShopRequest & Record<string, unknown> = {
      headers,
      params: { slug },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { request, result: guard.canActivate(context) };
  };
  const tma = (data: string) => ({ authorization: `tma ${data}` });

  beforeEach(() => {
    const config = new TelegramConfig({
      get: (n: string) =>
        n === 'TELEGRAM_TOKEN_KEY' ? 'e'.repeat(64) : undefined,
    } as unknown as ConfigService);
    crypto = new TokenCryptoService(config);
    prisma = {
      storeTelegramBot: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(botRow())),
      },
    };
    logger = { error: jest.fn() };
    guard = new TelegramShopGuard(
      prisma as unknown as PrismaService,
      crypto,
      logger as unknown as PinoLogger,
    );
  });

  it('lets a correctly signed customer in and sets the shop context from the address', async () => {
    const { request, result } = call(tma(initData(TOKEN, 4242)));

    await expect(result).resolves.toBe(true);
    expect(request.telegramShop).toEqual({
      storeId: 'store-1',
      storeName: 'Baraka',
      slug: 'baraka_888',
      botTokenEnc: expect.any(String) as unknown as string,
      notifyChatId: '555',
      telegramUserId: '4242',
      languageCode: 'ru',
    });
  });

  it('401 without the header or with another scheme, before any database access', async () => {
    const cases: Record<string, string>[] = [
      {},
      { authorization: 'Bearer abc' },
      { authorization: 'tma ' },
    ];
    for (const headers of cases) {
      await expect(call(headers).result).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    expect(prisma.storeTelegramBot.findUnique).not.toHaveBeenCalled();
  });

  it('401 for data signed by another bot, or for data that is too old', async () => {
    await expect(
      call(tma(initData(OTHER_TOKEN))).result,
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      call(tma(initData(TOKEN, 4242, 2 * 24 * 60 * 60))).result,
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('404 for an unknown or malformed address; junk never reaches the database', async () => {
    prisma.storeTelegramBot.findUnique.mockResolvedValue(null);
    await expect(
      call(tma(initData(TOKEN)), 'nope').result,
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.storeTelegramBot.findUnique.mockClear();
    await expect(
      call(tma(initData(TOKEN)), 'a b;c').result,
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.storeTelegramBot.findUnique).not.toHaveBeenCalled();
  });

  it('403 SHOP_UNAVAILABLE while the service is off, the store suspended or the bot paused', async () => {
    const cases = [
      botRow({}, { telegramShopEnabled: false }),
      botRow({}, { status: StoreStatus.SUSPENDED }),
      botRow({ isActive: false }),
    ];
    for (const row of cases) {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(row);
      await expect(call(tma(initData(TOKEN))).result).rejects.toMatchObject({
        response: { code: SHOP_UNAVAILABLE },
      });
    }
    await expect(call(tma(initData(TOKEN))).result).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('503 when the stored token cannot be read (key changed), and the log has no token', async () => {
    prisma.storeTelegramBot.findUnique.mockResolvedValue(
      botRow({ botTokenEnc: 'v1:bad:bad:bad' }),
    );

    await expect(call(tma(initData(TOKEN))).result).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    );
  });
});
