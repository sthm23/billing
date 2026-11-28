import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { TelegramConfig } from './telegram.config';
import { NOTIFY_CODE_TTL_MS } from './telegram.constants';
import { TokenCryptoService } from './token-crypto.service';

const KEY_HEX = 'a'.repeat(64);
const OTHER_KEY_HEX = 'b'.repeat(64);
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

function build(env: Record<string, string | undefined>) {
  const config = new TelegramConfig({
    get: (name: string) => env[name],
  } as unknown as ConfigService);

  return { config, crypto: new TokenCryptoService(config) };
}

describe('TelegramConfig', () => {
  it('accepts a 64-char hex key and a base64 key of 32 bytes', () => {
    expect(
      build({ TELEGRAM_TOKEN_KEY: KEY_HEX }).config.tokenKey(),
    ).toHaveLength(32);
    const base64 = Buffer.alloc(32, 7).toString('base64');
    expect(
      build({ TELEGRAM_TOKEN_KEY: base64 }).config.tokenKey(),
    ).toHaveLength(32);
  });

  it('rejects a missing or malformed key', () => {
    expect(build({}).config.tokenKey()).toBeNull();
    expect(build({ TELEGRAM_TOKEN_KEY: 'short' }).config.tokenKey()).toBeNull();
    expect(
      build({ TELEGRAM_TOKEN_KEY: 'a'.repeat(63) }).config.tokenKey(),
    ).toBeNull();
  });

  it('is configured only with the key and both addresses; builds URLs without double slashes', () => {
    const env = {
      TELEGRAM_TOKEN_KEY: KEY_HEX,
      TELEGRAM_WEBHOOK_BASE_URL: 'https://sthm23.uz/',
      TELEGRAM_MINIAPP_URL: 'https://shop.sthm23.uz/',
    };
    const { config } = build(env);

    expect(config.isConfigured()).toBe(true);
    expect(config.webhookUrl('baraka_888')).toBe(
      'https://sthm23.uz/api/telegram-shop/webhook/baraka_888',
    );
    expect(config.miniAppUrl('baraka_888')).toBe(
      'https://shop.sthm23.uz/baraka_888',
    );
    expect(
      build({ ...env, TELEGRAM_MINIAPP_URL: undefined }).config.isConfigured(),
    ).toBe(false);
    expect(() => build({}).config.miniAppUrl('x')).toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('TokenCryptoService', () => {
  const { crypto } = build({ TELEGRAM_TOKEN_KEY: KEY_HEX });

  it('round-trips a token and never stores it in the clear', () => {
    const stored = crypto.encrypt(TOKEN);

    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
    expect(crypto.decrypt(stored)).toBe(TOKEN);
  });

  it('uses a fresh IV, so the same token never gives the same text twice', () => {
    expect(crypto.encrypt(TOKEN)).not.toBe(crypto.encrypt(TOKEN));
  });

  it('refuses a changed value, another key and an unknown format', () => {
    const stored = crypto.encrypt(TOKEN);
    const [version, iv, tag, data] = stored.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;

    expect(() =>
      crypto.decrypt([version, iv, tag, flipped.toString('base64')].join(':')),
    ).toThrow();
    expect(() =>
      build({ TELEGRAM_TOKEN_KEY: OTHER_KEY_HEX }).crypto.decrypt(stored),
    ).toThrow();
    expect(() => crypto.decrypt('plain-text')).toThrow();
  });

  it('answers 503 instead of encrypting when the key is missing', () => {
    expect(() => build({}).crypto.encrypt(TOKEN)).toThrow(
      ServiceUnavailableException,
    );
  });

  describe('notify code', () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0);

    it('is valid for its shop within 15 minutes and fits a /start parameter', () => {
      const { code, expiresAt } = crypto.signNotifyCode('baraka_888', now);

      expect(code.length).toBeLessThanOrEqual(64);
      expect(code).toMatch(/^[A-Za-z0-9_]+$/);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(now + NOTIFY_CODE_TTL_MS);
      expect(expiresAt.getTime()).toBeGreaterThan(now);
      expect(crypto.verifyNotifyCode('baraka_888', code, now + 60_000)).toBe(
        true,
      );
    });

    it('expires', () => {
      const { code } = crypto.signNotifyCode('baraka_888', now);

      expect(
        crypto.verifyNotifyCode(
          'baraka_888',
          code,
          now + NOTIFY_CODE_TTL_MS + 120_000,
        ),
      ).toBe(false);
    });

    it('does not work for another shop, with a changed expiry or signature, or with junk', () => {
      const { code } = crypto.signNotifyCode('baraka_888', now);
      const [head, signature] = code.split('_');
      const later = (parseInt(head.slice(1), 36) + 600).toString(36);

      expect(crypto.verifyNotifyCode('other_shop', code, now)).toBe(false);
      expect(
        crypto.verifyNotifyCode('baraka_888', `n${later}_${signature}`, now),
      ).toBe(false);
      expect(
        crypto.verifyNotifyCode('baraka_888', `${head}_${'0'.repeat(24)}`, now),
      ).toBe(false);
      expect(crypto.verifyNotifyCode('baraka_888', 'hello', now)).toBe(false);
      expect(crypto.verifyNotifyCode('baraka_888', '', now)).toBe(false);
    });

    it('is not valid under another key', () => {
      const { code } = crypto.signNotifyCode('baraka_888', now);
      const other = build({ TELEGRAM_TOKEN_KEY: OTHER_KEY_HEX }).crypto;

      expect(other.verifyNotifyCode('baraka_888', code, now)).toBe(false);
    });
  });
});
