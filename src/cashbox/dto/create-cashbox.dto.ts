import { CashStatus, CashTransactionType, CashTransactionCategory, PaymentType } from "@generated/enums"
import { IsOptional, IsNumber, Min, IsEnum, IsNotEmpty, IsString } from "class-validator"

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