import { Type } from "class-transformer";
import { IsArray, IsDefined, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";
export class AttributeValueDto {
    @IsUUID("4")
    @IsNotEmpty()
    attributeId: string = "";

    @IsString()
    @IsNotEmpty()
    value: string = "";
}
export class CreateProductDto {
    @IsNotEmpty()
    @IsUUID('4')
    brandId!: string;

    @IsNotEmpty()
    @IsUUID('4')
    categoryId!: string;

    @IsNotEmpty()
    @IsUUID('4')
    storeId!: string;

    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsOptional()
    @IsArray()
    images!: string[];
}

export class CreateProductVariantDto {
    @IsUUID("4")
    @IsNotEmpty()
    productId: string = "";

    @IsOptional()
    @IsString()
    sku?: string;

    @IsOptional()
    @IsString()
    barCode?: string;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty()
    price: number = 0;

    // Атрибуты (например Attribute: color/size)
    @IsDefined()
    @ValidateNested()
    @Type(() => AttributeValueDto)
    color!: AttributeValueDto

    @IsDefined()
    @ValidateNested()
    @Type(() => AttributeValueDto)
    size!: AttributeValueDto

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AttributeValueDto)
    attributes?: AttributeValueDto[];
}

