import { OrderStatus } from "@generated/enums";
import { PaginationParams } from "@shared/dto/pagination-params.dto";
import { Transform, Type } from "class-transformer";
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

export class OrderQueryParams extends PaginationParams {
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(5)
    @Max(30)
    pageSize: number = 10;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    currentPage: number = 1;

    @IsOptional()
    @IsString()
    search?: string;


    @IsOptional()
    status?: OrderStatus;

    @IsOptional()
    @IsDateString()
    fromDate?: string

    @IsOptional()
    @IsDateString()
    toDate?: string;
}
