import { Type } from "class-transformer";
import { IsNumber, Min, IsNotEmpty, IsString, IsArray, ArrayMinSize, ValidateNested } from "class-validator";
import { ProductColorDTO } from "./product-color.dto";



export class ProductSizeDTO {
    id!: number

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty() // Обязательное поле
    quantity!: number;

    @IsString()
    @IsNotEmpty() // Обязательное поле
    size!: string;

    @IsArray()
    @ArrayMinSize(1)
    @Type(() => ProductColorDTO)
    @ValidateNested({ each: true })
    colors!: ProductColorDTO[]

    constructor(obj: ProductSizeDTO) {
        Object.assign(this, obj)
    }
}