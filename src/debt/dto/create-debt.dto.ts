import { PaymentType } from "@generated/enums";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, isDate, IsDateString, isDateString, IsEnum, IsNotEmpty, IsNumber, isNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";

export class CreateDebtDto {
    @IsNotEmpty()
    @IsUUID('4')
    storeId!: string;

    @IsNotEmpty()
    @IsUUID('4')
    customerId!: string;

    @IsNotEmpty()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    amount!: number;


    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsDateString()
    createdAt?: Date;

    @IsOptional()
    @IsDateString()
    returnedAt?: Date;
}

export class CreateDebtPaymentDto {
    @IsNotEmpty()
    @IsUUID('4')
    debtId!: string;

    @IsNotEmpty()
    @IsUUID('4')
    warehouseId!: string;

    @IsArray()
    @ArrayMinSize(1, { message: "At least one debt payment is required" })
    @ValidateNested({ each: true })
    payments!: CreateDebtPaymentItemDto[];
}

export class CreateDebtPaymentItemDto {
    @IsNotEmpty()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    amount!: number;

    @IsNotEmpty()
    @IsEnum(PaymentType)
    type: PaymentType = PaymentType.CASH;
}