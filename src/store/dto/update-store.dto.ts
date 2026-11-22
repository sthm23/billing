import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class UpdateStoreDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** Store sells goods; at least one of salesEnabled / rentalEnabled stays true */
  @IsOptional()
  @IsBoolean()
  salesEnabled?: boolean;

  /** Store rents goods out */
  @IsOptional()
  @IsBoolean()
  rentalEnabled?: boolean;

  @IsOptional()
  @IsString()
  warehouseName?: string;

  @IsNotEmpty()
  @IsArray()
  @IsUUID('4', { each: true })
  attributeIds!: string[];

  @IsNotEmpty()
  @IsArray()
  @IsUUID('4', { each: true })
  brandIds!: string[];
}
