import { Type } from "class-transformer";
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { ProductTag } from "@utils/model/product.model";
import { ProductSizeDTO } from "./product-size.dto";

export class CreateProductDto {
    @IsString()
    @IsNotEmpty() // Обязательное поле
    brand!: string;

    @IsString()
    @IsNotEmpty() // Обязательное поле
    category!: string;

    @IsString()
    @IsEnum(ProductTag)
    @IsNotEmpty() // Обязательное поле
    tag!: ProductTag;

    @IsString()
    @IsNotEmpty() // Обязательное поле
    description!: string;

    @IsString()
    @IsNotEmpty() // Обязательное поле
    name!: string;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty() // Обязательное поле
    price!: number;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty() // Обязательное поле
    quantity!: number;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty() // Обязательное поле
    discount!: number;

    @IsOptional()
    @IsArray()
    photo!: string[];

    @IsArray()
    @Type(() => ProductSizeDTO)
    @ValidateNested({ each: true })
    sizes!: ProductSizeDTO[]
}