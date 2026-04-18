import { OrderChannel, PaymentType } from "@generated/enums";
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsNumber, IsDateString, IsString, IsUUID, Min, ArrayMinSize, ValidateNested, isArray, } from "class-validator";
import { Type } from "class-transformer";
class OrderItemDto {
    @IsOptional()
    @IsUUID('4')
    itemId?: string

    @IsString()
    @IsUUID('4')
    variantId!: string

    @IsNotEmpty()
    @IsNumber()
    @Min(0)
    quantity: number = 0

    @IsNotEmpty()
    @IsNumber()
    @Min(0)
    retailPrice: number = 0

    @IsNotEmpty()
    @IsNumber()
    @Min(0)
    sale: number = 0

    @IsNotEmpty()
    @IsNumber()
    @Min(0)
    costAtSale: number = 0
}

class OrderAdditionalServiceDto {
    @IsString()
    @IsNotEmpty()
    name!: string

    @IsNotEmpty()
    @IsNumber()
    @Min(0)
    price: number = 0

    @IsOptional()
    @IsString()
    description?: string
}
export class CreateOrderItemDto {
    @IsString()
    @IsUUID('4')
    orderId!: string

    @IsOptional()
    @IsUUID('4')
    customerId?: string

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OrderAdditionalServiceDto)
    additionalServices: OrderAdditionalServiceDto[] = []

    @IsArray()
    @ArrayMinSize(1, { message: "At least one order item is required" })
    @ValidateNested({ each: true })
    @Type(() => OrderItemDto)
    items: OrderItemDto[] = []
}

export class CreateOrderDto {
    @IsString()
    @IsUUID('4')
    storeId!: string;

    @IsString()
    @IsUUID('4')
    warehouseId!: string

    @IsOptional()
    @IsUUID('4')
    customerId?: string

    @IsNotEmpty()
    @IsEnum(OrderChannel)
    channel: OrderChannel = OrderChannel.ONLINE
}

class OrderPaymentDto {
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
export class CreateOrderPaymentDto {
    @IsNotEmpty()
    @IsUUID('4')
    orderId!: string

    @IsOptional()
    @IsUUID('4')
    customerId?: string


    @IsArray()
    @ArrayMinSize(1, { message: "At least one payment is required" })
    @ValidateNested({ each: true })
    @Type(() => OrderPaymentDto)
    payments: OrderPaymentDto[] = []

}