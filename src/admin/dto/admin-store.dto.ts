import {
  AttributeType,
  StoreStatus,
  StoreSuspendReason,
} from '@generated/enums';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Empty strings of optional fields become undefined */
const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  return v === '' ? undefined : v;
};

/** «307 845 120» → «307845120» */
const digitsOnly = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.replace(/\s/g, '');
  return v === '' ? undefined : v;
};

export const STORE_MODES = ['sale', 'rent'] as const;
export type StoreMode = (typeof STORE_MODES)[number];

/** GET /admin/stores */
export class AdminStoreListParams {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(30)
  pageSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  currentPage?: number;

  /** Part of the store name, owner's full name or phone */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;

  /** sale — salesEnabled, rent — rentalEnabled */
  @IsOptional()
  @IsIn(STORE_MODES)
  mode?: StoreMode;
}

export class NewStoreOwnerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  /** +998 and 9 digits */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value,
  )
  @IsString()
  @Matches(/^\+998\d{9}$/, { message: 'phone must be +998 and 9 digits' })
  phone!: string;

  /** Latin letters, digits, dot and underscore */
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9._]{3,40}$/, {
    message: 'login may contain only latin letters, digits, dot and _',
  })
  login!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}

/** A product attribute (group) created together with the store */
export class NewStoreAttributeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @IsEnum(AttributeType)
  type!: AttributeType;

  /** Only for NUMBER: м, кг, л */
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(20)
  unit?: string;
}

/** POST /admin/stores — store, first warehouse and a new owner in one go */
export class CreateAdminStoreDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  /** A top-level category (store direction) */
  @IsUUID('4')
  categoryId!: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(250)
  address?: string;

  @IsOptional()
  @Transform(digitsOnly)
  @IsString()
  @Matches(/^\d{9}$/, { message: 'inn must be exactly 9 digits' })
  inn?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  note?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  warehouseName!: string;

  @ValidateNested()
  @Type(() => NewStoreOwnerDto)
  owner!: NewStoreOwnerDto;

  /** Brand names; missing ones are created (brands are global) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  brandNames?: string[];

  /** Existing attributes linked to the store */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  attributeIds?: string[];

  /** New attributes; an attribute with the same name is reused */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => NewStoreAttributeDto)
  newAttributes?: NewStoreAttributeDto[];

  @IsBoolean()
  salesEnabled!: boolean;

  @IsBoolean()
  rentalEnabled!: boolean;
}

/** PATCH /admin/stores/:id — only the fields sent are changed */
export class UpdateAdminStoreDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  salesEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  rentalEnabled?: boolean;
}

/** POST /admin/stores/:id/suspend */
export class SuspendStoreDto {
  @IsEnum(StoreSuspendReason)
  reason!: StoreSuspendReason;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(300)
  comment?: string;
}

/** POST /admin/stores/:id/resume */
export class ResumeStoreDto {
  /** Paid until (date); sent → the store becomes ACTIVE */
  @IsOptional()
  @IsDateString()
  paidUntil?: string;
}
