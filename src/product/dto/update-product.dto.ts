import { IsNotEmpty, IsNumber, Min } from "class-validator";

export class UpdateProductVariantPriceDTO {
    @IsNotEmpty()
    @IsNumber()
    @Min(0)
    price: number = 0;
}


export class UpdateProductDto { }
export class UpdateProductColorDTO { }