import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PRODUCT_IMAGE_MAX_COUNT } from '@shared/helper/file.helper';

/** Same limits as the mobile form */
export const PRODUCT_NAME_MAX = 120;
export const PRODUCT_DESCRIPTION_MAX = 1000;
import { MAX_CLEANING_DAYS } from '../../rental/dto/rental-lifecycle.dto';

export class UpdateProductVariantPriceDTO {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number = 0;

  /** Omitted = unchanged */
  @IsOptional()
  @IsBoolean()
  canSell?: boolean;

  /** Omitted = unchanged; true requires rentPricePerDay > 0 */
  @IsOptional()
  @IsBoolean()
  canRent?: boolean;

  /** Omitted = unchanged */
  @IsOptional()
  @IsNumber()
  @Min(0)
  rentPricePerDay?: number;

  /** Omitted = unchanged */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CLEANING_DAYS)
  defaultCleaningDays?: number;
}

/**
 * `PATCH /product/:id` — the product card; omitted fields stay as they are.
 * `attributeIds` only while the product has no variants; `images` is the full
 * new list (keys or public URLs), the first one is the main photo.
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRODUCT_NAME_MAX)
  name?: string;

  /** Empty string clears it */
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_DESCRIPTION_MAX)
  description?: string;

  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @IsOptional()
  @IsUUID('4')
  brandId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  attributeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_IMAGE_MAX_COUNT)
  @IsString({ each: true })
  images?: string[];
}
export class UpdateProductColorDTO {}
