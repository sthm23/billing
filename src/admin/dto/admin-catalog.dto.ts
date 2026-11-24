import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NewStoreAttributeDto } from './admin-store.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const CATALOG_PAGE_SIZE = 30;
export const CATALOG_PAGE_SIZE_MAX = 100;
export const BRAND_NAME_MAX = 60;

/** GET /admin/catalog/brands | attributes — dictionary search, most connected first */
export class CatalogSearchParams {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CATALOG_PAGE_SIZE_MAX)
  pageSize?: number;
}

/** POST /admin/stores/:id/brands — an existing brand, or a name (found or created) */
export class ConnectStoreBrandDto {
  @ValidateIf((dto: ConnectStoreBrandDto) => !dto.name)
  @IsUUID('4')
  brandId?: string;

  @ValidateIf((dto: ConnectStoreBrandDto) => !dto.brandId)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BRAND_NAME_MAX)
  name?: string;
}

/** POST /admin/stores/:id/attributes — an existing attribute, or a new one */
export class ConnectStoreAttributeDto {
  @ValidateIf((dto: ConnectStoreAttributeDto) => !dto.newAttribute)
  @IsUUID('4')
  attributeId?: string;

  @ValidateIf((dto: ConnectStoreAttributeDto) => !dto.attributeId)
  @ValidateNested()
  @Type(() => NewStoreAttributeDto)
  newAttribute?: NewStoreAttributeDto;
}
