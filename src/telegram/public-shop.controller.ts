import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AUTH_THROTTLE } from '@auth/auth-throttle';
import {
  CreateOnlineOrderDto,
  ShopProductsQueryDto,
} from './dto/public-shop.dto';
import {
  type CreatedOnlineOrder,
  PublicShopService,
  type ShopInfo,
  type ShopProduct,
  type ShopProductList,
} from './public-shop.service';
import {
  ORDER_CREATE_THROTTLE,
  PUBLIC_SHOP_THROTTLE,
} from './public-shop.throttle';
import { Shop, type ShopContext } from './shop-context';
import { TelegramShopGuard } from './telegram-shop.guard';

/**
 * PUBLIC API of the store's Telegram shop (no JWT, no accounts): the caller is the
 * Telegram user proven by `Authorization: tma <initData>`, the store is the `:slug` of
 * the address. The guard runs first, so the rate limit counts per customer.
 */
@UseGuards(TelegramShopGuard, ThrottlerGuard)
@Throttle(PUBLIC_SHOP_THROTTLE)
@SkipThrottle({ [AUTH_THROTTLE.LOGIN]: true })
@Controller('public/tg/:slug')
export class PublicShopController {
  constructor(private readonly service: PublicShopService) {}

  @Get('shop')
  getShop(@Shop() shop: ShopContext): Promise<ShopInfo> {
    return this.service.getShop(shop);
  }

  @Get('products')
  listProducts(
    @Shop() shop: ShopContext,
    @Query() query: ShopProductsQueryDto,
  ): Promise<ShopProductList> {
    return this.service.listProducts(shop, query);
  }

  @Get('products/:id')
  getProduct(
    @Shop() shop: ShopContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShopProduct> {
    return this.service.getProduct(shop, id);
  }

  @Post('orders')
  @Throttle(ORDER_CREATE_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  createOrder(
    @Shop() shop: ShopContext,
    @Body() dto: CreateOnlineOrderDto,
  ): Promise<CreatedOnlineOrder> {
    return this.service.createOrder(shop, dto);
  }
}
