import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  FEEDBACK_SOURCE,
  ORDER_ASSISTANT_LIMITS,
  type FeedbackSource,
} from '../order-assistant.constants';

/** `POST /order-assistant/match` — typed or transcribed text → review lines. */
export class MatchOrderTextDto {
  /** Working warehouse; checked against StaffOnWarehouse */
  @IsUUID('4')
  warehouseId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(ORDER_ASSISTANT_LIMITS.TEXT_LENGTH)
  text!: string;
}

export class FeedbackChoiceDto {
  /** `lines[].phrase` exactly as returned by `match` */
  @IsString()
  @IsNotEmpty()
  @MaxLength(ORDER_ASSISTANT_LIMITS.PHRASE_LENGTH)
  phrase!: string;

  @IsUUID('4')
  variantId!: string;

  @IsIn(Object.values(FEEDBACK_SOURCE))
  source!: FeedbackSource;
}

/** `POST /order-assistant/feedback` — what the seller chose, sent on «Добавить в корзину». */
export class OrderAssistantFeedbackDto {
  @IsUUID('4')
  warehouseId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ORDER_ASSISTANT_LIMITS.PHRASES)
  @ValidateNested({ each: true })
  @Type(() => FeedbackChoiceDto)
  choices!: FeedbackChoiceDto[];
}

/** `POST /order-assistant/transcribe` — multipart fields besides the `audio` file. */
export class TranscribeAudioDto {
  @IsUUID('4')
  warehouseId!: string;
}
