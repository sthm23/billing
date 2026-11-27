import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { CurrentUser } from '@auth/models/auth.model';
import { Prisma } from '@generated/client';
import { UserRole } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { ConnectBotDto } from './dto/telegram-bot.dto';
import { TelegramApiError, TelegramBotClient } from './telegram-bot.client';
import { TelegramConfig } from './telegram.config';
import {
  BOT_TEXTS,
  MENU_BUTTON_TEXT,
  NOTIFY_CHAT_NOT_CONNECTED,
  TELEGRAM_SHOP_DISABLED,
} from './telegram.constants';
import { TokenCryptoService } from './token-crypto.service';

const WEBHOOK_SECRET_BYTES = 24;

/** The bot as the app sees it. The token and the webhook secret never leave the server. */
export interface TelegramBotView {
  slug: string;
  botUsername: string;
  botLink: string;
  /** null while the server has no TELEGRAM_* settings */
  miniAppUrl: string | null;
  /** Somebody pressed the «receive requests here» link */
  notifyConnected: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface TelegramShopState {
  /** The paid service is switched on for the store (by a platform admin) */
  enabled: boolean;
  /** The server has the TELEGRAM_* settings */
  configured: boolean;
  bot: TelegramBotView | null;
}

export interface NotifyLink {
  /** Opens the bot's private chat with the code */
  link: string;
  /** Lets the owner pick a group; the bot joins it and receives the code */
  groupLink: string;
  expiresAt: Date;
}

type BotRow = NonNullable<
  Awaited<ReturnType<PrismaService['storeTelegramBot']['findUnique']>>
>;

/**
 * Connecting the store's own Telegram bot (docs/telegram-shop/PLAN.md, stage 2).
 * The owner pastes the token from @BotFather; we check it, store it encrypted
 * and point the bot's webhook and menu button at the shared Mini App.
 */
@Injectable()
export class StoreTelegramBotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TelegramBotClient,
    private readonly crypto: TokenCryptoService,
    private readonly config: TelegramConfig,
    @InjectPinoLogger(StoreTelegramBotService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getState(
    user: CurrentUser,
    storeId?: string,
  ): Promise<TelegramShopState> {
    const store = await this.loadStore(user, storeId);
    const bot = await this.prisma.storeTelegramBot.findUnique({
      where: { storeId: store.id },
    });

    return {
      enabled: store.telegramShopEnabled,
      configured: this.config.isConfigured(),
      bot: bot ? this.toView(bot) : null,
    };
  }

  async connect(
    dto: ConnectBotDto,
    user: CurrentUser,
  ): Promise<TelegramBotView> {
    const store = await this.loadStore(user, dto.storeId);
    this.config.assertConfigured();
    if (!store.telegramShopEnabled) {
      throw new ForbiddenException({
        code: TELEGRAM_SHOP_DISABLED,
        message: 'The Telegram shop is not switched on for this store',
      });
    }

    const { token, slug } = dto;
    const existing = await this.prisma.storeTelegramBot.findUnique({
      where: { storeId: store.id },
    });
    const slugOwner = await this.prisma.storeTelegramBot.findUnique({
      where: { slug },
      select: { storeId: true },
    });
    if (slugOwner && slugOwner.storeId !== store.id) {
      throw new ConflictException('This shop address is already taken');
    }

    const info = await this.checkToken(token);
    const botId = String(info.id);
    const sameBotElsewhere = await this.prisma.storeTelegramBot.findFirst({
      where: { botId, NOT: { storeId: store.id } },
      select: { id: true },
    });
    if (sameBotElsewhere) {
      throw new ConflictException(
        'This bot is already connected to another store',
      );
    }

    const webhookSecret = randomBytes(WEBHOOK_SECRET_BYTES).toString('hex');
    await this.telegramCall(async () => {
      await this.client.setWebhook(
        token,
        this.config.webhookUrl(slug),
        webhookSecret,
      );
      await this.client.setMenuButton(
        token,
        MENU_BUTTON_TEXT,
        this.config.miniAppUrl(slug),
      );
    });

    const sameBot = existing?.botId === botId;
    // Another bot replaces the old one: the old bot stops serving this shop
    if (existing && !sameBot) await this.release(existing);

    const data = {
      slug,
      botTokenEnc: this.crypto.encrypt(token),
      botId,
      botUsername: info.username,
      webhookSecret,
      isActive: true,
      notifyChatId: sameBot ? existing.notifyChatId : null,
    };
    let saved: BotRow;
    try {
      saved = await this.prisma.storeTelegramBot.upsert({
        where: { storeId: store.id },
        create: { storeId: store.id, ...data },
        update: data,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This shop address is already taken');
      }
      throw error;
    }

    this.logger.info(
      { storeId: store.id, botId, slug },
      'Telegram bot connected',
    );

    return this.toView(saved);
  }

  /** Works for a switched-off store too: the owner can always take the bot back. */
  async disconnect(
    user: CurrentUser,
    storeId?: string,
  ): Promise<{ disconnected: true }> {
    const store = await this.loadStore(user, storeId);
    const bot = await this.requireBot(store.id);
    await this.release(bot);
    await this.prisma.storeTelegramBot.delete({ where: { id: bot.id } });
    this.logger.info(
      { storeId: store.id, botId: bot.botId },
      'Telegram bot disconnected',
    );

    return { disconnected: true };
  }

  async createNotifyLink(
    user: CurrentUser,
    storeId?: string,
  ): Promise<NotifyLink> {
    const store = await this.loadStore(user, storeId);
    this.config.assertConfigured();
    const bot = await this.requireBot(store.id);
    const { code, expiresAt } = this.crypto.signNotifyCode(bot.slug);
    const base = `https://t.me/${bot.botUsername}`;

    return {
      link: `${base}?start=${code}`,
      groupLink: `${base}?startgroup=${code}`,
      expiresAt,
    };
  }

  async sendTest(user: CurrentUser, storeId?: string): Promise<{ sent: true }> {
    const store = await this.loadStore(user, storeId);
    const bot = await this.requireBot(store.id);
    if (!bot.notifyChatId) {
      throw new BadRequestException({
        code: NOTIFY_CHAT_NOT_CONNECTED,
        message: 'Press the «receive requests here» link in Telegram first',
      });
    }
    const token = this.crypto.decrypt(bot.botTokenEnc);
    await this.telegramCall(() =>
      this.client.sendMessage(
        token,
        bot.notifyChatId as string,
        BOT_TEXTS.ru.test(store.name),
      ),
    );

    return { sent: true };
  }

  /** The store of the signed-in employee; only a platform ADMIN names it (and it must exist). */
  private async loadStore(user: CurrentUser, storeId?: string) {
    let id: string;
    if (user.role === UserRole.ADMIN) {
      if (!storeId) throw new BadRequestException('storeId is required');
      id = storeId;
    } else if (user.staff) {
      id = user.staff.storeId;
    } else {
      throw new ForbiddenException('No store');
    }

    const store = await this.prisma.store.findUnique({
      where: { id },
      select: { id: true, name: true, telegramShopEnabled: true },
    });
    if (!store) throw new NotFoundException('Store not found');

    return store;
  }

  private async requireBot(storeId: string): Promise<BotRow> {
    const bot = await this.prisma.storeTelegramBot.findUnique({
      where: { storeId },
    });
    if (!bot) throw new NotFoundException('The bot is not connected');

    return bot;
  }

  private async checkToken(token: string) {
    const info = await this.telegramCall(
      () => this.client.getMe(token),
      'Invalid bot token',
    );
    if (!info.isBot || !info.username) {
      throw new BadRequestException('Invalid bot token');
    }

    return info;
  }

  /** Telegram refused (not the network): the owner can fix it, so it is a 400 with Telegram's reason. */
  private async telegramCall<T>(
    call: () => Promise<T>,
    unauthorizedMessage?: string,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof TelegramApiError) {
        if (error.isUnauthorized && unauthorizedMessage) {
          throw new BadRequestException(unauthorizedMessage);
        }
        throw new BadRequestException(
          `Telegram: ${error.description || error.errorCode}`,
        );
      }
      throw error;
    }
  }

  /** Takes the webhook and the menu button back from a bot; best effort (the token may be revoked already). */
  private async release(bot: BotRow): Promise<void> {
    try {
      const token = this.crypto.decrypt(bot.botTokenEnc);
      await this.client.deleteWebhook(token);
      await this.client.resetMenuButton(token);
    } catch {
      this.logger.warn(
        { storeId: bot.storeId, botId: bot.botId },
        'Could not release the Telegram bot',
      );
    }
  }

  private toView(bot: BotRow): TelegramBotView {
    return {
      slug: bot.slug,
      botUsername: bot.botUsername,
      botLink: `https://t.me/${bot.botUsername}`,
      miniAppUrl: this.config.isConfigured()
        ? this.config.miniAppUrl(bot.slug)
        : null,
      notifyConnected: bot.notifyChatId !== null,
      isActive: bot.isActive,
      createdAt: bot.createdAt,
    };
  }
}
