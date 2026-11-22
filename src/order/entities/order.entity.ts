import { OrderStatus } from '@generated/enums';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  Matches,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { DateRangeParams } from '@shared/dto/date-range.dto';

const STATUS_NAMES = Object.values(OrderStatus).join('|');
/** `HOLD` or `COMPLETED,DEBT,REFUNDED` — only known statuses */
const ORDER_STATUS_LIST = new RegExp(
  `^(${STATUS_NAMES})(,(${STATUS_NAMES}))*$`,
);

export class OrderQueryParams extends PaginationParams {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(30)
  pageSize: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  currentPage: number = 1;

  @IsOptional()
  @IsString()
  search?: string;

  /** Comma list of `OrderStatus` (e.g. `COMPLETED,DEBT`) */
  @IsOptional()
  @IsString()
  @Matches(ORDER_STATUS_LIST, {
    message: 'status must be a comma list of order statuses',
  })
  status?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  /** Which date `fromDate` / `toDate` filter: `created` (default) or `sold` (sale date) */
  @IsOptional()
  @IsIn(['created', 'sold'])
  dateBy?: 'created' | 'sold';

  /** Orders of this customer (of the caller's store — the store scope applies) */
  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  /** Only orders whose return is paid out later (CREDIT): the store owes the customer */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  owedToCustomer?: boolean;

  /** Only orders of this warehouse (the app's working warehouse) */
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;
}

/** GET /orders/summary: period + optional warehouse */
export class OrderSummaryParams extends DateRangeParams {
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;
}
