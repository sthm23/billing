import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator"
import { PaymentType } from "@generated/enums"
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
