import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class UpdateStoreDto {
    @IsOptional()
    @IsString()
    name?: string;

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
