import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_CLEANING_DAYS } from '../../rental/dto/rental-lifecycle.dto';
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

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsNotEmpty()
  quantity: number = 0;

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

  @IsOptional()
  @IsArray()
  images!: string[];

  @IsNotEmpty()
  @IsArray()
  @IsUUID('4', { each: true })
  attributeIds: string[] = [];

  @IsNotEmpty()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds: string[] = [];
}
