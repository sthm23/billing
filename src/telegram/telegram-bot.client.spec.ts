import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { TelegramApiError, TelegramBotClient } from './telegram-bot.client';
import { TelegramConfig } from './telegram.config';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

describe('TelegramBotClient', () => {
  const logger = { warn: jest.fn() };
  const client = new TelegramBotClient(
    new TelegramConfig({ get: () => undefined } as unknown as ConfigService),
    logger as unknown as PinoLogger,
  );
  const fetchMock = jest.spyOn(global, 'fetch');

  beforeEach(() => {
    fetchMock.mockReset();
    logger.warn.mockReset();
  });
  afterAll(() => fetchMock.mockRestore());

  const reply = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }),
    );

  const lastBody = () =>
    JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;

  it('getMe posts to the bot method and maps the answer', async () => {
    reply({
      ok: true,
      result: { id: 123456789, is_bot: true, username: 'baraka_888_bot' },
    });

    await expect(client.getMe(TOKEN)).resolves.toEqual({
      id: 123456789,
      username: 'baraka_888_bot',
      isBot: true,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.telegram.org/bot${TOKEN}/getMe`,
    );
  });

  it('setWebhook sends the secret and asks only for messages', async () => {
    reply({ ok: true, result: true });

    await client.setWebhook(
      TOKEN,
      'https://sthm23.uz/api/telegram-shop/webhook/baraka',
      'sec',
    );

    expect(lastBody()).toMatchObject({
      url: 'https://sthm23.uz/api/telegram-shop/webhook/baraka',
      secret_token: 'sec',
      allowed_updates: ['message'],
    });
  });

  it('setMenuButton opens the Mini App; resetMenuButton restores the default', async () => {
    reply({ ok: true, result: true });
    await client.setMenuButton(
      TOKEN,
      'Магазин',
      'https://shop.sthm23.uz/baraka',
    );
    expect(lastBody()).toEqual({
      menu_button: {
        type: 'web_app',
        text: 'Магазин',
        web_app: { url: 'https://shop.sthm23.uz/baraka' },
      },
    });

    reply({ ok: true, result: true });
    await client.resetMenuButton(TOKEN);
    expect(lastBody()).toEqual({ menu_button: { type: 'default' } });
  });

  it('sendMessage adds the Mini App button only when asked', async () => {
    reply({ ok: true, result: {} });
    await client.sendMessage(TOKEN, 42, 'hi');
    expect(lastBody()).toEqual({ chat_id: 42, text: 'hi' });

    reply({ ok: true, result: {} });
    await client.sendMessage(TOKEN, 42, 'hi', {
      text: 'Open',
      url: 'https://shop.sthm23.uz/b',
    });
    expect(lastBody().reply_markup).toEqual({
      inline_keyboard: [
        [{ text: 'Open', web_app: { url: 'https://shop.sthm23.uz/b' } }],
      ],
    });
  });

  it('turns ok:false into TelegramApiError; 401 and 404 mean a bad token', async () => {
    reply({ ok: false, error_code: 401, description: 'Unauthorized' }, 401);

    const error = await client.getMe(TOKEN).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).isUnauthorized).toBe(true);
    expect((error as TelegramApiError).description).toBe('Unauthorized');

    reply(
      {
        ok: false,
        error_code: 403,
        description: 'bot was blocked by the user',
      },
      403,
    );
    const blocked = await client
      .sendMessage(TOKEN, 1, 'x')
      .catch((e: unknown) => e);
    expect((blocked as TelegramApiError).isUnauthorized).toBe(false);
  });

  it('answers 503 when Telegram is unreachable, and the log never contains the token', async () => {
    fetchMock.mockRejectedValueOnce(
      new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getMe`),
    );

    await expect(client.getMe(TOKEN)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    );
  });

  it('answers 503 for a non-JSON reply (a proxy error page)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>502</html>', { status: 502 }),
    );

    await expect(client.getMe(TOKEN)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
