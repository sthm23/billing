import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const CATEGORY_NAME_MIN = 2;
export const CATEGORY_NAME_MAX = 50;

/** `POST /category/subcategory` — find or create a subcategory of a store direction. */
export class CreateSubcategoryDto {
  /** Level-1 category (store direction) */
  @IsNotEmpty()
  @IsUUID('4')
  parentId!: string;

  /** Trimmed and length-checked (2–50) by the service */
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  name!: string;
}

/** `PATCH /category/subcategory/:id` (ADMIN) — an empty nameUz / nameEn clears the translation. */
export class UpdateSubcategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameUz?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;
}
