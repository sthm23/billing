import { ArrayMinSize, IsArray, IsDateString, IsEnum, isNotEmpty, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator"
import { CashStatus, CashTransactionCategory, CashTransactionType, PaymentType } from "@generated/enums"
import { Type } from "class-transformer"

export class CreatePaymentItemDto {
    @IsNotEmpty()
    @IsEnum(PaymentType)
    type: PaymentType = PaymentType.CASH

    @IsNumber()
    @Min(0)
    amount!: number

    @IsOptional()
    @IsDateString()
    paidAt: Date | null = null
}
export class CreatePaymentDto {

    @IsString()
    @IsUUID('4')
    orderId!: string

    @IsOptional()
    @IsUUID('4')
    customerId?: string

    @IsArray()
    @ArrayMinSize(1, { message: "At least one payment is required" })
    @ValidateNested({ each: true })
    @Type(() => CreatePaymentItemDto)
    payments: CreatePaymentItemDto[] = []
}

export class CreateReturnPaymentDto {

    @IsArray()
    @ArrayMinSize(1, { message: "At least one payment is required" })
    @ValidateNested({ each: true })
    @Type(() => CreatePaymentItemDto)
    payments: CreatePaymentItemDto[] = []
}

export class CreateCashBoxDto {
    @IsOptional()
    @IsNumber()
    @Min(0)
    balance!: number

    @IsEnum(CashStatus)
    status!: CashStatus
}

export class CreateCashTransactionDto {
    @IsEnum(CashTransactionType)
    type: CashTransactionType = CashTransactionType.EXPENSE

    @IsEnum(CashTransactionCategory)
    category: CashTransactionCategory = CashTransactionCategory.DELIVERY

    @IsEnum(PaymentType)
    paymentType: PaymentType = PaymentType.CASH

    @IsNotEmpty()
    @IsNumber()
    @Min(0)
    amount!: number

    @IsNotEmpty()
    @IsString()
    comment!: string
}