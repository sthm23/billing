import { Type } from "class-transformer";
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";

export class CreateProductDto {
    @IsNotEmpty()
    @IsUUID('4')
    brand!: string;

    @IsNotEmpty()
    @IsUUID('4')
    category!: string;

    @IsNotEmpty()
    @IsUUID('4')
    storeId!: string;

    @IsString()
    @IsNotEmpty()
    name!: string;


    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty()
    price!: number;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty()
    quantity!: number;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty()
    discount!: number;

    @IsOptional()
    @IsArray()
    photo!: string[];
}