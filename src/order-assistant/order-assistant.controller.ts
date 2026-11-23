import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { AUTH_THROTTLE } from '@auth/auth-throttle';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { CurrentUser } from '@shared/decorators/user.decorator';
import {
  MatchOrderTextDto,
  OrderAssistantFeedbackDto,
  TranscribeAudioDto,
} from './dto/order-assistant.dto';
import {
  ORDER_ASSISTANT_THROTTLE,
  TRANSCRIBE_LIMITS,
} from './order-assistant.constants';
import {
  FeedbackResponse,
  MatchResponse,
  OrderAssistantService,
  TranscribeResponse,
} from './order-assistant.service';

/**
 * Voice / text order assistant (docs/voice-order/DESIGN.md §5). Any staff with
 * access to the warehouse — the same people who can create orders there.
 * Throttler runs after AuthJWTGuard so the limit is per user.
 */
@UseGuards(AuthJWTGuard, ThrottlerGuard)
@Throttle(ORDER_ASSISTANT_THROTTLE)
@SkipThrottle({ [AUTH_THROTTLE.LOGIN]: true })
@Controller('order-assistant')
export class OrderAssistantController {
  constructor(private readonly orderAssistantService: OrderAssistantService) {}

  /** Voice → text (stage 3). Multipart: `audio` file + `warehouseId`; the audio is not stored. */
  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: TRANSCRIBE_LIMITS.FILE_BYTES, files: 1 },
    }),
  )
  transcribe(
    @Body() dto: TranscribeAudioDto,
    @UploadedFile() audio: Express.Multer.File | undefined,
    @CurrentUser() user: CurrentUserType,
  ): Promise<TranscribeResponse> {
    return this.orderAssistantService.transcribe(dto, audio, user);
  }

  @Post('match')
  @HttpCode(HttpStatus.OK)
  match(
    @Body() dto: MatchOrderTextDto,
    @CurrentUser() user: CurrentUserType,
  ): Promise<MatchResponse> {
    return this.orderAssistantService.match(dto, user);
  }

  @Post('feedback')
  @HttpCode(HttpStatus.OK)
  feedback(
    @Body() dto: OrderAssistantFeedbackDto,
    @CurrentUser() user: CurrentUserType,
  ): Promise<FeedbackResponse> {
    return this.orderAssistantService.feedback(dto, user);
  }
}
