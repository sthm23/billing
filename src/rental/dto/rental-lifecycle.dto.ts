import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentType } from '@generated/enums';
import {
  CreateRentalPaymentDto,
  RentalPaymentItemDto,
} from './rental-payment.dto';

/** Longest dry cleaning a seller may set for one item, days */
export const MAX_CLEANING_DAYS = 30;

/** POST /rental/:id/issue: collaterals and extra payments taken at issue */
export class IssueRentalDto extends CreateRentalPaymentDto {}

export class RentalReturnItemDto {
  @IsUUID('4')
  orderItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  /** 0 = no dry cleaning */
  @IsInt()
  @Min(0)
  @Max(MAX_CLEANING_DAYS)
  cleaningDays!: number;
}

/** Body of POST /rental/:id/returns/preview and /returns */
export class RentalReturnDto {
  /** Default — now; in the past only OWNER/MANAGER */
  @IsOptional()
  @IsISO8601({ strict: true })
  returnedAt?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => RentalReturnItemDto)
  items!: RentalReturnItemDto[];

  /** Damage and/or late return (R4, R10); requires penaltyComment */
  @IsOptional()
  @IsNumber()
  @Min(0)
  penaltyAmount?: number;

  @IsOptional()
  @IsString()
  penaltyComment?: string;

  /** Lowers the total on an early return; OWNER/MANAGER only (R4) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  earlyReturnRefund?: number;

  /** How the overpaid money is given back after earlyReturnRefund */
  @IsOptional()
  @IsEnum(PaymentType)
  refundPaymentType?: PaymentType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalPaymentItemDto)
  payments?: RentalPaymentItemDto[];

  /** Open cashbox of the store; default — the employee's own open cashbox */
  @IsOptional()
  @IsUUID('4')
  cashboxId?: string;
}

/** POST /rental/:id/cancel (OWNER/MANAGER) */
export class CancelRentalDto {
  /** Part of the prepayment given back: 0 … paidAmount */
  @IsNumber()
  @Min(0)
  refundAmount!: number;

  @IsOptional()
  @IsEnum(PaymentType)
  refundPaymentType?: PaymentType;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsUUID('4')
  cashboxId?: string;
}

/**
 * GET /rental/:id/cleaning-conflicts
 * `items=orderItemId:quantity:cleaningDays,...`
 */
export class CleaningConflictsQuery {
  @IsOptional()
  @IsISO8601({ strict: true })
  returnedAt?: string;

  @IsString()
  items!: string;
}
