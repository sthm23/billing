import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { WEBHOOK_SECRET_HEADER } from './telegram.constants';
import {
  type TelegramUpdate,
  TelegramWebhookService,
} from './telegram-webhook.service';

/**
 * PUBLIC (no JWT): Telegram calls it. The caller is proven by the secret
 * header set in `setWebhook`; the shop comes from the address, not the body.
 */
@Controller('telegram-shop/webhook')
export class TelegramWebhookController {
  constructor(private readonly service: TelegramWebhookService) {}

  @Post(':slug')
  @HttpCode(HttpStatus.OK)
  handle(
    @Param('slug') slug: string,
    @Headers(WEBHOOK_SECRET_HEADER) secret: string | undefined,
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    return this.service.handleUpdate(slug, secret, update ?? {});
  }
}
