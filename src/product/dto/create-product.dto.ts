import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";
export class AttributeValueDto {
    @IsUUID("4")
    @IsNotEmpty()
    attributeValueId: string = "";

    @IsNotEmpty()
    value: string | number = "";
}
export class ProductVariantDto {
    @IsOptional()
    @IsString()
    barCode?: string;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty()
    retailPrice: number = 0;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty()
    costPrice: number = 0;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty()
    quantity: number = 0;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AttributeValueDto)
    attributes: AttributeValueDto[] = [];
}
export class CreateProductVariantDto {
    @IsUUID("4")
    @IsNotEmpty()
    storeId: string = "";

    @IsUUID("4")
    @IsNotEmpty()
    warehouseId: string = "";

    @IsUUID("4")
    @IsNotEmpty()
    productId: string = "";

    @IsNotEmpty()
    @IsString()
    category: string = "";

    @IsArray()
    @ArrayMinSize(1, { message: "At least one variant is required" })
    @ValidateNested({ each: true })
    @Type(() => ProductVariantDto)
    variants: ProductVariantDto[] = [];
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


    @IsNotEmpty()
    @IsArray()
    @IsUUID('4', { each: true })
    attributeIds: string[] = [];
}