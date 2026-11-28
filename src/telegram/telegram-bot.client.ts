import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { TelegramConfig } from './telegram.config';
import { TELEGRAM_API_TIMEOUT_MS } from './telegram.constants';

export interface BotInfo {
  id: number;
  username: string;
  isBot: boolean;
}

/** Inline button that opens a Mini App (private chats only). */
export interface WebAppButton {
  text: string;
  url: string;
}

/** Telegram answered `ok: false` (wrong token, bot blocked, chat not found, …). */
export class TelegramApiError extends Error {
  constructor(
    readonly errorCode: number,
    readonly description: string,
  ) {
    super(`Telegram API error ${errorCode}: ${description}`);
  }

  /** The token was revoked or never existed. */
  get isUnauthorized(): boolean {
    return this.errorCode === 401 || this.errorCode === 404;
  }
}

interface TelegramReply<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

/**
 * The only place that talks to the Telegram Bot API. The token is part of the
 * request URL, so it is never logged: errors log the method name only.
 */
@Injectable()
export class TelegramBotClient {
  constructor(
    private readonly config: TelegramConfig,
    @InjectPinoLogger(TelegramBotClient.name)
    private readonly logger: PinoLogger,
  ) {}

  async getMe(token: string): Promise<BotInfo> {
    const me = await this.call<{
      id: number;
      username?: string;
      is_bot: boolean;
    }>(token, 'getMe');

    return { id: me.id, username: me.username ?? '', isBot: me.is_bot };
  }

  /** Updates go to `url` with `secret` in the `X-Telegram-Bot-Api-Secret-Token` header. */
  async setWebhook(token: string, url: string, secret: string): Promise<void> {
    await this.call(token, 'setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
  }

  async deleteWebhook(token: string): Promise<void> {
    await this.call(token, 'deleteWebhook', { drop_pending_updates: true });
  }

  /** The button next to the message field of every chat with the bot. */
  async setMenuButton(
    token: string,
    text: string,
    webAppUrl: string,
  ): Promise<void> {
    await this.call(token, 'setChatMenuButton', {
      menu_button: { type: 'web_app', text, web_app: { url: webAppUrl } },
    });
  }

  async resetMenuButton(token: string): Promise<void> {
    await this.call(token, 'setChatMenuButton', {
      menu_button: { type: 'default' },
    });
  }

  async sendMessage(
    token: string,
    chatId: string | number,
    text: string,
    button?: WebAppButton,
  ): Promise<void> {
    await this.call(token, 'sendMessage', {
      chat_id: chatId,
      text,
      ...(button
        ? {
            reply_markup: {
              inline_keyboard: [
                [{ text: button.text, web_app: { url: button.url } }],
              ],
            },
          }
        : {}),
    });
  }

  private async call<T>(
    token: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    let reply: TelegramReply<T>;
    let status: number;
    try {
      const response = await fetch(
        `${this.config.apiUrl}/bot${token}/${method}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
        },
      );
      status = response.status;
      reply = (await response.json()) as TelegramReply<T>;
    } catch {
      // The error object is not logged: its text may repeat the URL (and the token in it)
      this.logger.warn({ method }, 'Telegram API is unavailable');
      throw new ServiceUnavailableException(
        'Telegram is unavailable, try again in a moment',
      );
    }

    if (!reply.ok) {
      throw new TelegramApiError(
        reply.error_code ?? status,
        reply.description ?? '',
      );
    }

    return reply.result as T;
  }
}
