import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_TELEGRAM_API_URL,
  TELEGRAM_NOT_CONFIGURED,
} from './telegram.constants';

const KEY_BYTES = 32;

/**
 * Where the Telegram shop lives, read from the environment:
 * - `TELEGRAM_TOKEN_KEY` — AES-256 key for bot tokens (64 hex chars or base64 of 32 bytes);
 * - `TELEGRAM_WEBHOOK_BASE_URL` — public HTTPS address of this API (nginx), e.g. https://sthm23.uz;
 * - `TELEGRAM_MINIAPP_URL` — address of the shared Mini App, e.g. https://shop.sthm23.uz;
 * - `TELEGRAM_API_URL` — optional, Bot API server (default api.telegram.org).
 * Missing values do not stop the API: the Telegram shop answers 503 instead.
 */
@Injectable()
export class TelegramConfig {
  constructor(private readonly config: ConfigService) {}

  get apiUrl(): string {
    return (this.read('TELEGRAM_API_URL') ?? DEFAULT_TELEGRAM_API_URL).replace(
      /\/+$/,
      '',
    );
  }

  isConfigured(): boolean {
    return (
      this.tokenKey() !== null &&
      this.read('TELEGRAM_WEBHOOK_BASE_URL') !== null &&
      this.read('TELEGRAM_MINIAPP_URL') !== null
    );
  }

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException({
        code: TELEGRAM_NOT_CONFIGURED,
        message: 'Telegram shop is not configured on the server',
      });
    }
  }

  /** Public URL Telegram calls for the shop's bot (`/api` is the global prefix). */
  webhookUrl(slug: string): string {
    this.assertConfigured();

    return `${this.read('TELEGRAM_WEBHOOK_BASE_URL')}/api/telegram-shop/webhook/${slug}`;
  }

  /** Address of the shop in the shared Mini App. */
  miniAppUrl(slug: string): string {
    this.assertConfigured();

    return `${this.read('TELEGRAM_MINIAPP_URL')}/${slug}`;
  }

  /** AES key, or null when missing / malformed. */
  tokenKey(): Buffer | null {
    const raw = this.read('TELEGRAM_TOKEN_KEY');
    if (!raw) return null;
    const key = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');

    return key.length === KEY_BYTES ? key : null;
  }

  private read(name: string): string | null {
    const value = this.config.get<string>(name)?.trim();

    return value ? value.replace(/\/+$/, '') : null;
  }
}
