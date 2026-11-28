import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { StoreStatus } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { verifyInitData } from './init-data';
import type { ShopRequest } from './shop-context';
import {
  BOT_SLUG_PATTERN,
  PUBLIC_SHOP,
  SHOP_UNAVAILABLE,
} from './telegram.constants';
import { TokenCryptoService } from './token-crypto.service';

/** `Authorization: tma <initData>` — the scheme Telegram Mini Apps use. */
const AUTH_SCHEME = /^tma\s+(.+)$/i;

/**
 * Door of the public shop API (`/public/tg/:slug/*`). There are no accounts here: a
 * customer is whoever Telegram says opened this shop's bot. The signature is checked with
 * the token of THIS shop's bot, so data from another bot (or a forged one) is refused.
 * Order of checks keeps junk cheap: no header → 401 before any database access.
 */
@Injectable()
export class TelegramShopGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TokenCryptoService,
    @InjectPinoLogger(TelegramShopGuard.name)
    private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<
        ShopRequest & {
          params: Record<string, string | undefined>;
          headers: Record<string, string | string[] | undefined>;
        }
      >();

    const header = request.headers.authorization;
    const initData = typeof header === 'string' ? AUTH_SCHEME.exec(header)?.[1] : undefined;
    if (!initData) throw new UnauthorizedException('Open the shop from Telegram');

    const slug = request.params.slug ?? '';
    const bot = BOT_SLUG_PATTERN.test(slug)
      ? await this.prisma.storeTelegramBot.findUnique({
          where: { slug },
          include: {
            store: {
              select: { id: true, name: true, telegramShopEnabled: true, status: true },
            },
          },
        })
      : null;
    if (!bot) throw new NotFoundException('Shop not found');

    const { store } = bot;
    if (
      !bot.isActive ||
      !store.telegramShopEnabled ||
      store.status === StoreStatus.SUSPENDED
    ) {
      throw new ForbiddenException({
        code: SHOP_UNAVAILABLE,
        message: 'The shop is temporarily unavailable',
      });
    }

    let token: string;
    try {
      token = this.crypto.decrypt(bot.botTokenEnc);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error({ storeId: store.id }, 'Cannot decrypt the shop bot token');
      throw new ServiceUnavailableException('The shop is temporarily unavailable');
    }

    const user = verifyInitData(initData, token, PUBLIC_SHOP.INIT_DATA_MAX_AGE_SEC);
    if (!user || user.isBot) {
      throw new UnauthorizedException('Open the shop from Telegram');
    }

    request.telegramShop = {
      storeId: store.id,
      storeName: store.name,
      slug,
      botTokenEnc: bot.botTokenEnc,
      notifyChatId: bot.notifyChatId,
      telegramUserId: String(user.id),
      languageCode: user.languageCode,
    };

    return true;
  }
}
