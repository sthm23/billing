import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationParams } from '@shared/dto/pagination-params.dto';

/** Query of `GET /product`: pagination + search and filters. */
export class ProductListParams extends PaginationParams {
  /** Product name, variant SKU or barcode */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** A subcategory, or a store direction (then all its subcategories match) */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Only products with total stock ≤ LOW_STOCK_THRESHOLD */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  lowStock?: boolean;

  /** Only products of this warehouse (the app's working warehouse) */
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;
}
