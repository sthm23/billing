import { DebtStatus } from "@generated/enums";
import { PaginationParams } from "@shared/dto/pagination-params.dto";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export class DebtQueryParams extends PaginationParams {
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
    @IsUUID('4')
    customerId?: string;


    @IsOptional()
    status?: DebtStatus;

    @IsOptional()
    @IsDateString()
    fromDate?: string

    @IsOptional()
    @IsDateString()
    toDate?: string;
}

/** `GET /debt/debtors`: search by name/phone, sort, period of «paid» (client's month bounds). */
export class DebtorsQueryParams {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsIn(['amount', 'date'])
    sort?: 'amount' | 'date';

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}
