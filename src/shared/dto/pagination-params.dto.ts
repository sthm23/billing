
import { IsNumber, Min, IsOptional, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationParams {
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(5)
    @Max(30)
    pageSize?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    currentPage?: number;
}