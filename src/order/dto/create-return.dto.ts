import { PaymentType, ReturnReason } from '@generated/enums';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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

  /** Why the goods are returned — information only */
  @IsOptional()
  @IsEnum(ReturnReason)
  reason?: ReturnReason;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(500)
  comment?: string;

  /** Open cashbox of the store to pay out from; default — the employee's own open cashbox. Used only with a payout */
  @IsOptional()
  @IsUUID('4')
  cashboxId?: string;
}
