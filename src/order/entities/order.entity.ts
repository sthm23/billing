import { OrderStatus } from '@generated/enums';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { DateRangeParams } from '@shared/dto/date-range.dto';

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

  @IsOptional()
  status?: OrderStatus;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

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
