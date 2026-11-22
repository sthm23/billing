import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentType } from '@generated/enums';
import { LOCAL_DATE } from './create-rental.dto';
import { MAX_CLEANING_DAYS } from './rental-lifecycle.dto';

const LOCAL_DATE_MESSAGE = '$property must be a date in YYYY-MM-DD format';
/** Query values stay strings (no transform pipe): 1–2 digits, range checked in the service */
const DAYS_STRING = /^\d{1,2}$/;
export const MAX_CLEANING_COMMENT_LENGTH = 500;

/** POST /rental/cleanings (R13): OWNER/MANAGER plans dry cleaning of one unit */
export class CreateRentalCleaningDto {
  @IsUUID('4')
  warehouseId!: string;

  @IsUUID('4')
  variantId!: string;

  /** First cleaning day (salon local date), today or later */
  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  startDate!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_CLEANING_DAYS)
  days!: number;

  /** Expense written to the cashbox at once */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsEnum(PaymentType)
  paymentType!: PaymentType;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CLEANING_COMMENT_LENGTH)
  comment?: string;

  /** Any open cashbox of the store; default — the employee's own open one */
  @IsOptional()
  @IsUUID('4')
  cashboxId?: string;
}

/** POST /rental/cleanings/:id/cancel: where the expense is written back */
export class CancelRentalCleaningDto {
  /** Default — the cashbox of the expense if still open, else the employee's own */
  @IsOptional()
  @IsUUID('4')
  cashboxId?: string;
}

/** GET /rental/cleanings/check: may one more unit go to dry cleaning on these days */
export class RentalCleaningCheckQuery {
  @IsUUID('4')
  warehouseId!: string;

  @IsUUID('4')
  variantId!: string;

  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  startDate!: string;

  @Matches(DAYS_STRING, { message: 'days must be a number' })
  days!: string;
}

/** GET /rental/cleanings: active cleanings not finished before `from` */
export class RentalCleaningListQuery {
  @IsUUID('4')
  warehouseId!: string;

  @IsOptional()
  @IsUUID('4')
  variantId?: string;

  /** Default — today */
  @IsOptional()
  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  to?: string;
}
