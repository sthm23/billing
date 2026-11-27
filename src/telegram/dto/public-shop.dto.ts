import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { normalizePhone } from '../public-shop.helpers';
import { PUBLIC_SHOP } from '../telegram.constants';
import { REGION_CODES } from '../uz-regions';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim();

  return v === '' ? undefined : v;
};

const phone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (normalizePhone(value) ?? value) : value;

/** GET /public/tg/:slug/products */
export class ShopProductsQueryDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(100)
  search?: string;

  /** A subcategory, or a direction (then its subcategories are included) */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PUBLIC_SHOP.MAX_PAGE_SIZE)
  pageSize?: number;
}

export class OnlineOrderItemDto {
  @IsUUID()
  variantId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PUBLIC_SHOP.MAX_ITEM_QUANTITY)
  quantity!: number;
}

/** POST /public/tg/:slug/orders — prices are never taken from the client. */
export class CreateOnlineOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PUBLIC_SHOP.MAX_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => OnlineOrderItemDto)
  items!: OnlineOrderItemDto[];

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  /** Uzbek mobile number: +998 and 9 digits (spaces and dashes are fine) */
  @Transform(phone)
  @IsString()
  @Matches(/^\+998\d{9}$/, { message: 'Phone must be +998 and 9 digits' })
  phone!: string;

  /** Code from `GET /shop` → `regions` */
  @IsIn(REGION_CODES)
  region!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  district!: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  comment?: string;
}
