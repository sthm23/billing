import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { AUTH_THROTTLE } from '@auth/auth-throttle';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { CurrentUser } from '@shared/decorators/user.decorator';
import {
  MatchOrderTextDto,
  OrderAssistantFeedbackDto,
} from './dto/order-assistant.dto';
import { ORDER_ASSISTANT_THROTTLE } from './order-assistant.constants';
import {
  FeedbackResponse,
  MatchResponse,
  OrderAssistantService,
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
