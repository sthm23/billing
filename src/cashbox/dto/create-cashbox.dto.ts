import { CashStatus, CashTransactionType, CashTransactionCategory, PaymentType } from "@generated/enums"
import { IsOptional, IsNumber, Min, IsEnum, IsNotEmpty, IsString, IsUUID } from "class-validator"

export class CreateCashBoxDto {
    @IsOptional()
    @IsNumber()
    @Min(0)
    balance!: number

    @IsEnum(CashStatus)
    status!: CashStatus

    @IsNotEmpty()
    @IsUUID('4')
    storeId!: string

    @IsNotEmpty()
    @IsUUID('4')
    warehouseId!: string
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

    @IsOptional()
    @IsUUID('4')
    orderId?: string
}