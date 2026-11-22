import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionGuard } from '@shared/guards/subscription.guard';

/**
 * JWT check + subscription check: a valid token of a user whose store is
 * suspended gets 403 STORE_SUSPENDED (see SubscriptionGuard).
 */
@Injectable()
export class AuthJWTGuard extends AuthGuard('jwt-access') {
  private readonly subscription: SubscriptionGuard;

  constructor(reflector: Reflector) {
    super();
    this.subscription = new SubscriptionGuard(reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;

    return this.subscription.canActivate(context);
  }
}
