import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PRODUCT_IMAGE_MAX_COUNT,
  PRODUCT_IMAGE_MAX_SIZE,
  PRODUCT_IMAGE_MIME_TYPES,
} from '@shared/helper/file.helper';

export class CreateProductImageDto {
  /** Ignored: the store comes from the token. Kept optional for the legacy web client. */
  @IsOptional()
  @IsUUID('4')
  storeId?: string;

  @IsString()
  fileName!: string;

  /** Exact byte size of the file that will be uploaded (it is signed into the URL) */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRODUCT_IMAGE_MAX_SIZE, { message: 'Image must be 5 MB or smaller' })
  fileSize!: number;

  @IsIn(PRODUCT_IMAGE_MIME_TYPES, {
    message: 'Only JPEG, PNG or WebP images are allowed',
  })
  mimeType!: string;
}

export class CreateProductImageResponseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRODUCT_IMAGE_MAX_COUNT, {
    message: `At most ${PRODUCT_IMAGE_MAX_COUNT} images`,
  })
  @ValidateNested({ each: true })
  @Type(() => CreateProductImageDto)
  files!: CreateProductImageDto[];
}
