import { Transform, Type } from 'class-transformer';
import { PRODUCT_IMAGE_MAX_COUNT } from '@shared/helper/file.helper';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_CLEANING_DAYS } from '../../rental/dto/rental-lifecycle.dto';

/** Manual barcode: EAN-8 / UPC-A / EAN-13 / ITF-14 — digits only */
export const BARCODE_PATTERN = /^\d{8,14}$/;
export class AttributeValueDto {
  @IsUUID('4')
  @IsNotEmpty()
  attributeValueId: string = '';

  @IsNotEmpty()
  value: string | number = '';
}
export class ProductVariantDto {
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsNotEmpty()
  retailPrice: number = 0;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsNotEmpty()
  costPrice: number = 0;

  /** Default true */
  @IsOptional()
  @IsBoolean()
  canSell?: boolean;

  /** Default false; true requires rentPricePerDay > 0 */
  @IsOptional()
  @IsBoolean()
  canRent?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  rentPricePerDay?: number;

  /** Dry-cleaning days suggested on rental return; default 1 */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  @Max(MAX_CLEANING_DAYS)
  defaultCleaningDays?: number;

  /** 0 = future goods: Inventory 0, no StockMovement (stock comes with a later receipt) */
  @IsInt()
  @Type(() => Number)
  @Min(0)
  @IsNotEmpty()
  quantity: number = 0;

  /** Own (factory) barcode, digits 8–14, must be free in the store; omitted/empty → generated */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_, value) => value !== '' && value != null)
  @Matches(BARCODE_PATTERN, { message: 'Barcode must be 8–14 digits' })
  barCode?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeValueDto)
  attributes: AttributeValueDto[] = [];
}
export class CreateProductVariantDto {
  @IsUUID('4')
  @IsNotEmpty()
  storeId: string = '';

  @IsUUID('4')
  @IsNotEmpty()
  warehouseId: string = '';

  @IsUUID('4')
  @IsNotEmpty()
  productId: string = '';

  /** @deprecated Ignored — the SKU uses the product's category name from the DB. Kept so old clients still validate. */
  @IsOptional()
  @IsString()
  category?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one variant is required' })
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants: ProductVariantDto[] = [];
}

export class CreateProductDto {
  @IsNotEmpty()
  @IsUUID('4')
  brandId!: string;

  @IsNotEmpty()
  @IsUUID('4')
  categoryId!: string;

  @IsNotEmpty()
  @IsUUID('4')
  warehouseId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Object keys from POST /image/upload (a full URL under S3_PUBLIC_URL is accepted too) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_IMAGE_MAX_COUNT)
  @IsString({ each: true })
  images?: string[];

  @IsNotEmpty()
  @IsArray()
  @IsUUID('4', { each: true })
  attributeIds: string[] = [];

  @IsNotEmpty()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds: string[] = [];
}
