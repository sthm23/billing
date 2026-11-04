import { OrderChannel, PaymentType } from '@generated/enums';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReturnItemDto {
  @IsString()
  @IsUUID('4')
  itemId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;
  // Prices and cost are taken from the order line; extra fields from older clients are ignored
}

class ReturnOrderPaymentDto {
  @IsNotEmpty()
  @IsEnum(PaymentType)
  type: PaymentType = PaymentType.CASH;

  @IsNumber()
  @Min(1)
  amount!: number;
}

export class CreateReturnOrderDto {
  @IsString()
  @IsUUID('4')
  orderId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one return order item is required' })
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[] = [];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnOrderPaymentDto)
  returnPayments: ReturnOrderPaymentDto[] = [];
}
