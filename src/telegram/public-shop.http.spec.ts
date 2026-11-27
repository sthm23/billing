import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import {
  Global,
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getLoggerToken } from 'nestjs-pino';
import request from 'supertest';
import { authThrottleOptions } from '@auth/auth-throttle';
import { Prisma } from '@generated/client';
import { StoreStatus } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { OrderService } from '@order/order.service';
import { UserService } from '@user/user.service';
import { OnlineOrderService } from './online-order.service';
import { PublicShopService } from './public-shop.service';
import { StoreTelegramBotService } from './store-telegram-bot.service';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramShopGuard } from './telegram-shop.guard';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TelegramConfig } from './telegram.config';
import { TelegramModule } from './telegram.module';
import { TokenCryptoService } from './token-crypto.service';

/**
 * The public shop API through a real Nest app (same global prefix and ValidationPipe as
 * main.ts, real guards and rate limiter); only the database and the logger are stubs.
 */
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const OTHER_TOKEN = '987654321:ZZZdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const ENV: Record<string, string> = { TELEGRAM_TOKEN_KEY: 'f'.repeat(64) };
const V1 = '11111111-1111-4111-8111-111111111111';
const BASE = '/api/public/tg/baraka_888';

function initData(userId: number, token = TOKEN): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000) - 30),
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

const tma = (userId: number, token = TOKEN) => `tma ${initData(userId, token)}`;

const orderBody = (overrides: Record<string, unknown> = {}) => ({
  items: [{ variantId: V1, quantity: 1 }],
  fullName: 'Ali Valiyev',
  phone: '+998901234567',
  region: 'samarkand',
  district: 'Urgut',
  ...overrides,
});

describe('Public shop API over HTTP', () => {
  let app: INestApplication;
  let prisma: Record<string, any>;
  let botRow: Record<string, any>;

  beforeAll(async () => {
    const crypto = new TokenCryptoService(
      new TelegramConfig({
        get: (n: string) => ENV[n],
      } as unknown as ConfigService),
    );
    botRow = {
      slug: 'baraka_888',
      botTokenEnc: crypto.encrypt(TOKEN),
      // no chat: nothing is sent to Telegram from this test
      notifyChatId: null,
      isActive: true,
      store: {
        id: 'store-1',
        name: 'Baraka',
        telegramShopEnabled: true,
        status: StoreStatus.ACTIVE,
      },
    };
    prisma = {
      storeTelegramBot: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(botRow)),
      },
      product: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: V1,
            price: new Prisma.Decimal('1200000'),
            product: { name: 'Strapela' },
            attributes: [],
          },
        ]),
      },
      onlineOrder: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _max: { number: 0 } }),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: { number: number } }) =>
            Promise.resolve({
              id: 'o1',
              number: data.number,
              createdAt: new Date(),
            }),
          ),
      },
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
    };

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

    @Global()
    @Module({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (n: string) => ENV[n] } },
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

    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot(authThrottleOptions),
        GlobalsStub,
        TelegramModule,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe()); // as in main.ts
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app.close());

  it('401 without Telegram data, and no database work for it', async () => {
    const res = await request(app.getHttpServer()).get(`${BASE}/shop`);

    expect(res.status).toBe(401);
    expect(prisma.storeTelegramBot.findUnique).not.toHaveBeenCalled();
  });

  it('401 for data signed by another bot', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/shop`)
      .set('Authorization', tma(1, OTHER_TOKEN))
      .expect(401);
  });

  it('404 for an unknown shop address', async () => {
    prisma.storeTelegramBot.findUnique.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .get('/api/public/tg/nobody/shop')
      .set('Authorization', tma(2))
      .expect(404);
  });

  it('403 SHOP_UNAVAILABLE for a suspended store', async () => {
    prisma.storeTelegramBot.findUnique.mockResolvedValueOnce({
      ...botRow,
      store: { ...botRow.store, status: StoreStatus.SUSPENDED },
    });

    const res = await request(app.getHttpServer())
      .get(`${BASE}/shop`)
      .set('Authorization', tma(3));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SHOP_UNAVAILABLE');
  });

  it('GET /shop returns the store name and the 14 regions', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/shop`)
      .set('Authorization', tma(4));

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Baraka');
    expect(res.body.regions).toHaveLength(14);
  });

  it('GET /products validates the query with the real pipe', async () => {
    const http = request(app.getHttpServer());

    await http
      .get(`${BASE}/products?pageSize=31`)
      .set('Authorization', tma(5))
      .expect(400);
    await http
      .get(`${BASE}/products?categoryId=nope`)
      .set('Authorization', tma(5))
      .expect(400);
    const ok = await http
      .get(`${BASE}/products?pageSize=10&currentPage=2`)
      .set('Authorization', tma(5));

    expect(ok.status).toBe(200);
    expect(prisma.product.findMany.mock.calls.at(-1)?.[0]).toMatchObject({
      skip: 10,
      take: 10,
    });
  });

  it('GET /products/:id answers 400 for a bad id and 404 for a missing product', async () => {
    const http = request(app.getHttpServer());

    await http
      .get(`${BASE}/products/not-a-uuid`)
      .set('Authorization', tma(6))
      .expect(400);
    await http
      .get(`${BASE}/products/${V1}`)
      .set('Authorization', tma(6))
      .expect(404);
  });

  describe('POST /orders', () => {
    it('201 with the request number; the price in the body is ignored', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/orders`)
        .set('Authorization', tma(7))
        .send(orderBody({ items: [{ variantId: V1, quantity: 2, price: 1 }] }));

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        number: 1,
        status: 'NEW',
        total: '2400000',
      });
      expect(
        prisma.onlineOrder.create.mock.calls.at(-1)?.[0].data.items.create[0],
      ).toEqual({
        variantId: V1,
        quantity: 2,
        priceAtRequest: new Prisma.Decimal('1200000'),
      });
    });

    it('400 for a bad body, and nothing is saved', async () => {
      prisma.onlineOrder.create.mockClear();
      const http = request(app.getHttpServer());
      const send = (body: object) =>
        http.post(`${BASE}/orders`).set('Authorization', tma(8)).send(body);

      expect((await send(orderBody({ phone: '12345' }))).status).toBe(400);
      expect((await send(orderBody({ region: 'mars' }))).status).toBe(400);
      expect((await send(orderBody({ items: [] }))).status).toBe(400);
      expect((await send({})).status).toBe(400);
      expect(prisma.onlineOrder.create).not.toHaveBeenCalled();
    });

    it('401 without Telegram data', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/orders`)
        .send(orderBody())
        .expect(401);
    });

    it('allows 10 requests a minute per customer, then 429; another customer is not affected', async () => {
      const http = request(app.getHttpServer());
      const post = (userId: number) =>
        http
          .post(`${BASE}/orders`)
          .set('Authorization', tma(userId))
          .send(orderBody());

      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) statuses.push((await post(100)).status);

      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
      expect(statuses[10]).toBe(429);
      // same IP, another Telegram user: counted separately
      expect((await post(101)).status).toBe(201);
    });
  });

  it('allows 120 reads a minute per customer, then 429; another customer is not affected', async () => {
    const http = request(app.getHttpServer());
    const read = (userId: number) =>
      http.get(`${BASE}/shop`).set('Authorization', tma(userId));

    let lastOk = 0;
    let firstBlocked = 0;
    for (let i = 1; i <= 121; i++) {
      const { status } = await read(200);
      if (status === 200) lastOk = i;
      else if (!firstBlocked) firstBlocked = i;
    }

    expect(lastOk).toBe(120);
    expect(firstBlocked).toBe(121);
    expect((await read(201)).status).toBe(200);
  });
});
