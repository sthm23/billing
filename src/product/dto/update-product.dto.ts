import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
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

export class UpdateProductDto {}
export class UpdateProductColorDTO {}
