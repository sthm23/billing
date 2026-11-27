import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import type { CurrentUser as UserInfo } from '@auth/models/auth.model';
import { UserRole } from '@generated/enums';
import { Roles } from '@shared/decorators/role.decorator';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import { ConnectBotDto, StoreScopeDto } from './dto/telegram-bot.dto';
import {
  type NotifyLink,
  StoreTelegramBotService,
  type TelegramBotView,
  type TelegramShopState,
} from './store-telegram-bot.service';

/**
 * Connecting the store's Telegram bot: the store OWNER (and a platform ADMIN,
 * who names the store in `storeId`). The store is never taken from the client
 * for the owner.
 */
@UseGuards(AuthJWTGuard, RolesGuard)
@Roles(UserRole.OWNER)
@Controller('telegram-shop/bot')
export class TelegramBotController {
  constructor(private readonly service: StoreTelegramBotService) {}

  @Get()
  getState(
    @Query() query: StoreScopeDto,
    @CurrentUser() user: UserInfo,
  ): Promise<TelegramShopState> {
    return this.service.getState(user, query.storeId);
  }

  @Put()
  connect(
    @Body() dto: ConnectBotDto,
    @CurrentUser() user: UserInfo,
  ): Promise<TelegramBotView> {
    return this.service.connect(dto, user);
  }

  @Delete()
  disconnect(
    @Query() query: StoreScopeDto,
    @CurrentUser() user: UserInfo,
  ): Promise<{ disconnected: true }> {
    return this.service.disconnect(user, query.storeId);
  }

  @Post('notify-link')
  @HttpCode(HttpStatus.OK)
  createNotifyLink(
    @Body() dto: StoreScopeDto,
    @CurrentUser() user: UserInfo,
  ): Promise<NotifyLink> {
    return this.service.createNotifyLink(user, dto.storeId);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  sendTest(
    @Body() dto: StoreScopeDto,
    @CurrentUser() user: UserInfo,
  ): Promise<{ sent: true }> {
    return this.service.sendTest(user, dto.storeId);
  }
}
