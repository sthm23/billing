
import { IsNumber, Min, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationParams {
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(5)
    pageSize?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    currentPage?: number;
}