import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Owner dashboard period `[from, to)` + optional warehouse (none = the whole store).
 * The client sends its local day bounds (Asia/Tashkent); at most 31 days (checked by the service).
 */
export class DashboardParams {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
