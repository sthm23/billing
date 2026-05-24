import { Type } from "class-transformer";
import { IsOptional, IsNumber, Min, Max } from "class-validator";


export class AttributeParams {
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(5)
    @Max(100)
    pageSize?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    currentPage?: number;
}