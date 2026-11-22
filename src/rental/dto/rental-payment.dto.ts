import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { CollateralType, PaymentType } from '@generated/enums';

export class RentalPaymentItemDto {
  @IsEnum(PaymentType)
  type!: PaymentType;

  @IsNumber()
  @Min(0)
  amount!: number;
}

/** Passport, gold etc.: kept by the salon, never goes to the cashbox */
export class RentalCollateralDto {
  @IsEnum(CollateralType)
  type!: CollateralType;

  @IsString()
  @IsNotEmpty()
  description!: string;
}

/** POST /rental/:id/payments: prepayment / extra payment and/or collateral */
export class CreateRentalPaymentDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalPaymentItemDto)
  payments?: RentalPaymentItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalCollateralDto)
  collaterals?: RentalCollateralDto[];

  /** Open cashbox of the store to take the money; default — the employee's own open cashbox */
  @IsOptional()
  @IsUUID('4')
  cashboxId?: string;
}
