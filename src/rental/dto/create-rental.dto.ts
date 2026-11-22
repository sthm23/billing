import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

/** Local date of the salon (`Asia/Tashkent`), without time */
export const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_MESSAGE = '$property must be a date in YYYY-MM-DD format';

export class RentalItemDto {
  @IsUUID('4')
  variantId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  /**
   * Discount per unit, already distributed by the client. The price itself is
   * set by the backend: rentPricePerDay × plannedDays.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  sale?: number;
}

export class RentalServiceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sale?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

/** Body of POST /rental and PATCH /rental/:id */
export class CreateRentalDto {
  @IsUUID('4')
  warehouseId!: string;

  @IsUUID('4')
  customerId!: string;

  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  startDate!: string;

  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  endDate!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => RentalItemDto)
  items!: RentalItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalServiceDto)
  services?: RentalServiceDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRentalDto extends CreateRentalDto {}
