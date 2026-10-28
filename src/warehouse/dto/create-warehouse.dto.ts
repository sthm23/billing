import { StockMovementReason, StockMovementType } from '@generated/enums';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateWarehouseStaffDto {
  @IsNotEmpty()
  @IsString()
  login: string = '';

  @IsNotEmpty()
  @IsString()
  password: string = '';

  @IsNotEmpty()
  @IsString()
  fullName: string = '';

  @IsNotEmpty()
  @IsString()
  phone: string = '';

  @IsNotEmpty()
  @IsUUID('4')
  storeId: string = '';

  constructor(dto: Partial<CreateWarehouseStaffDto>) {
    Object.assign(this, dto);
  }
}
export class CreateWarehouseDto {
  @IsNotEmpty()
  @IsUUID('4')
  storeId: string = '';

  @IsNotEmpty()
  @IsString()
  name: string = '';

  @IsNotEmpty()
  @IsUUID('4')
  ownerId: string = '';

  @IsOptional()
  @ValidateNested()
  worker?: CreateWarehouseStaffDto;

  constructor(dto: Partial<CreateWarehouseDto>) {
    Object.assign(this, dto);
  }
}

/**
 * Stock receipt or write-off. Allowed: IN + PURCHASE (costPrice required),
 * IN + ADJUSTMENT, OUT + ADJUSTMENT. Sales and returns move stock through orders.
 */
export class InventoryMovementDto {
  @IsNotEmpty()
  @IsUUID('4')
  variantId!: string;

  /** Ignored: the warehouse comes from the URL (kept for older clients) */
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  quantity!: number;

  /** Unit purchase cost; required for a purchase */
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  costPrice?: number;

  /** New sale price of the variant; omitted keeps the current price */
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  price?: number;

  @IsNotEmpty()
  @IsEnum(StockMovementType)
  type: StockMovementType = StockMovementType.IN;

  @IsNotEmpty()
  @IsEnum(StockMovementReason)
  reason: StockMovementReason = StockMovementReason.PURCHASE;
}
