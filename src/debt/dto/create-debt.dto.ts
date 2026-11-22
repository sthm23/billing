import { PaymentType } from "@generated/enums";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, isDate, IsDateString, isDateString, IsEnum, IsNotEmpty, IsNumber, isNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from "class-validator";

export class CreateDebtDto {
    /** Ignored for staff (their store from the token; a different one → 400); required for an admin */
    @IsOptional()
    @IsUUID('4')
    storeId?: string;

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
    @MaxLength(500)
    description?: string;

    /** When the debt arose; may be in the past, not in the future. Default — now */
    @IsOptional()
    @IsDateString()
    createdAt?: string;

    /** Repay by; not before createdAt. Omitted or null — no term */
    @IsOptional()
    @IsDateString()
    returnedAt?: string | null;
}

export class CreateDebtPaymentDto {
    @IsNotEmpty()
    @IsUUID('4')
    debtId!: string;

    /** Preferred warehouse of the employee's own open cashbox (optional) */
    @IsOptional()
    @IsUUID('4')
    warehouseId?: string;

    /** Open cashbox of the store to take the money; default — the employee's own open cashbox */
    @IsOptional()
    @IsUUID('4')
    cashboxId?: string;

    @IsArray()
    @ArrayMinSize(1, { message: "At least one debt payment is required" })
    @ValidateNested({ each: true })
    @Type(() => CreateDebtPaymentItemDto)
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