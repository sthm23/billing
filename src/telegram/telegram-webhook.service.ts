import { timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { StoreStatus } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramConfig } from './telegram.config';
import {
  BOT_SLUG_PATTERN,
  BOT_TEXTS,
  type BotLanguage,
} from './telegram.constants';
import { TokenCryptoService } from './token-crypto.service';

/** The part of a Telegram update we read. Untrusted: every field may be missing. */
export interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { language_code?: string };
  };
}

/** `/start`, `/start payload`, `/start@bot payload` */
const START_COMMAND = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/;

/**
 * Updates of the store's bot (docs/telegram-shop/PLAN.md, stage 2). Telegram
 * retries on any non-2xx answer, so everything after the secret check answers
 * `ok` even when sending a reply fails.
 */
@Injectable()
export class TelegramWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TelegramBotClient,
    private readonly crypto: TokenCryptoService,
    private readonly config: TelegramConfig,
    @InjectPinoLogger(TelegramWebhookService.name)
    private readonly logger: PinoLogger,
  ) {}

  async handleUpdate(
    slug: string,
    secret: string | undefined,
    update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    const bot = BOT_SLUG_PATTERN.test(slug)
      ? await this.prisma.storeTelegramBot.findUnique({
          where: { slug },
          include: {
            store: {
              select: { name: true, telegramShopEnabled: true, status: true },
            },
          },
        })
      : null;
    if (!bot) throw new NotFoundException();
    if (!this.secretMatches(bot.webhookSecret, secret)) {
      throw new ForbiddenException();
    }

    const { store } = bot;
    const serving =
      bot.isActive &&
      store.telegramShopEnabled &&
      store.status !== StoreStatus.SUSPENDED;
    const message = update.message;
    const chatId = message?.chat?.id;
    const command = message?.text ? START_COMMAND.exec(message.text) : null;
    if (!serving || !command || chatId === undefined) return { ok: true };

    const texts = BOT_TEXTS[this.language(message?.from?.language_code)];
    const payload = command[1];
    try {
      const token = this.crypto.decrypt(bot.botTokenEnc);
      if (payload?.startsWith('n')) {
        const valid = this.crypto.verifyNotifyCode(slug, payload);
        if (valid) {
          await this.prisma.storeTelegramBot.update({
            where: { id: bot.id },
            data: { notifyChatId: String(chatId) },
          });
          this.logger.info(
            { storeId: bot.storeId },
            'Telegram notification chat connected',
          );
        }
        await this.client.sendMessage(
          token,
          chatId,
          valid ? texts.notifyConnected : texts.notifyExpired,
        );
      } else {
        // A Mini App button is allowed in a private chat only
        const button =
          message?.chat?.type === 'private'
            ? { text: texts.openShop, url: this.config.miniAppUrl(slug) }
            : undefined;
        await this.client.sendMessage(
          token,
          chatId,
          texts.greeting(store.name),
          button,
        );
      }
    } catch (error) {
      this.logger.warn(
        {
          storeId: bot.storeId,
          err: error instanceof Error ? error.message : 'unknown',
        },
        'Telegram webhook reply failed',
      );
    }

    return { ok: true };
  }

  private secretMatches(expected: string, given: string | undefined): boolean {
    if (!given) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(given);

    return a.length === b.length && timingSafeEqual(a, b);
  }

  private language(code: string | undefined): BotLanguage {
    return code?.toLowerCase().startsWith('uz') ? 'uz' : 'ru';
  }
}
