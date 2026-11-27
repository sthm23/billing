import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Who is calling the public shop API and for which store — set by `TelegramShopGuard`
 * after the signature is verified. The store comes from the address (`:slug`), never from the body.
 */
export interface ShopContext {
  storeId: string;
  storeName: string;
  slug: string;
  /** Encrypted: decrypted only to write a message through the shop's bot */
  botTokenEnc: string;
  notifyChatId: string | null;
  /** Telegram user id of the customer */
  telegramUserId: string;
  languageCode: string | null;
}

export type ShopRequest = { telegramShop?: ShopContext };

export const Shop = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ShopContext => {
    const request = ctx.switchToHttp().getRequest<ShopRequest>();
    if (!request.telegramShop) {
      throw new Error('TelegramShopGuard did not run before this handler');
    }

    return request.telegramShop;
  },
);
