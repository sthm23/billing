import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from "class-validator"
import { PaymentType } from "@generated/enums"
export class CreatePaymentDto {

    @IsString()
    @IsUUID('4')
    orderId!: string

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
