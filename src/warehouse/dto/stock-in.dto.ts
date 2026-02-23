import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsNumber, IsUUID, Min, ValidateNested } from "class-validator";


class StockInItemDto {
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
export class StockInDto {
    @IsUUID("4")
    @IsNotEmpty()
    storeId: string = "";

    @IsArray()
    @ArrayMinSize(1, { message: "At least one stock item is required" })
    @ValidateNested({ each: true })
    @Type(() => StockInItemDto)
    items: StockInItemDto[] = [];
}
