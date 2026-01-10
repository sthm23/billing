import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsNumber, IsUUID, Min } from "class-validator";

export class StockInDto {
    @IsUUID("4")
    @IsNotEmpty()
    warehouseId: string = "";

    @IsUUID("4")
    @IsNotEmpty()
    variantId: string = "";

    @IsInt()
    @Type(() => Number)
    @Min(1)
    quantity: number = 1;

    @IsNumber()
    @Type(() => Number)
    @Min(0)
    unitCost: number = 0; // закупочная цена за единицу (для IN/PURCHASE)
}