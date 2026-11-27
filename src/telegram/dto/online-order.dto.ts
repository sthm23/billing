import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OnlineOrderStatus } from '@generated/enums';
import { ONLINE_ORDERS } from '../telegram.constants';

const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim();

  return v === '' ? undefined : v;
};

/** GET /online-orders — the store comes from the token */
export class OnlineOrderListParams {
  /** Omitted: all statuses */
  @IsOptional()
  @IsEnum(OnlineOrderStatus)
  status?: OnlineOrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentPage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ONLINE_ORDERS.MAX_PAGE_SIZE)
  pageSize?: number;
}

/** POST /online-orders/:id/confirm */
export class ConfirmOnlineOrderDto {
  /** The warehouse the sale order is created on: one of the employee's warehouses */
  @IsUUID()
  warehouseId!: string;
}

/** POST /online-orders/:id/reject */
export class RejectOnlineOrderDto {
  /** Shown to the customer */
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(ONLINE_ORDERS.MAX_REJECT_REASON)
  reason?: string;
}
