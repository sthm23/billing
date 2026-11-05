import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

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
}

export class UpdateProductDto {}
export class UpdateProductColorDTO {}
