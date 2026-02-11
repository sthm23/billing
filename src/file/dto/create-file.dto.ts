import { Type } from "class-transformer";
import { IsArray, IsMimeType, IsNumber, IsString, IsUUID, ValidateNested } from "class-validator";

export class CreateProductImageDto {
    @IsUUID("4")
    storeId!: string

    @IsString()
    fileName!: string

    @IsNumber()
    @Type(() => Number)
    fileSize!: number

    @IsMimeType()
    mimeType!: string
}

export class CreateProductImageResponseDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateProductImageDto)
    files!: CreateProductImageDto[]
}