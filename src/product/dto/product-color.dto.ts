import { Type } from "class-transformer";
import { IsString, IsNotEmpty, IsNumber, Min } from "class-validator";
import { ProductColor } from "@utils/model/product.model";



export class ProductColorDTO {
    @IsString()
    @IsNotEmpty() // Обязательное поле
    color!: string;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    @IsNotEmpty() // Обязательное поле
    stock!: number;

    sold: number = 0;
    userId?: number
    productId?: number
    sizeId?: number
    constructor(obj: Omit<ProductColor, '_id'>) {
        Object.assign(this, obj);
    }
}