import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StoreStatus, StoreSuspendReason, UserRole } from '@generated/enums';
import { ALLOW_SUSPENDED_STORE_KEY } from '@shared/decorators/allow-suspended-store.decorator';

/** Error code the clients look for to show «Магазин приостановлен» */
export const STORE_SUSPENDED_CODE = 'STORE_SUSPENDED';

export type SubscriptionUser = {
  role: UserRole;
  staff?: {
    store?: {
      name: string;
      status: StoreStatus;
      suspendedAt: Date | null;
      suspendReason: StoreSuspendReason | null;
    } | null;
  } | null;
};

/**
 * Throws 403 STORE_SUSPENDED when the user's store is suspended by an admin.
 * Admins (no store) always pass.
 */
export function assertStoreNotSuspended(
  user: SubscriptionUser | null | undefined,
): void {
  if (!user || user.role === UserRole.ADMIN) return;
  const store = user.staff?.store;
  if (store?.status !== StoreStatus.SUSPENDED) return;

  throw new ForbiddenException({
    statusCode: 403,
    code: STORE_SUSPENDED_CODE,
    message: 'Store is suspended',
    store: {
      name: store.name,
      reason: store.suspendReason,
      suspendedAt: store.suspendedAt,
    },
  });
}

/**
 * Subscription check: the app works only while the store is not suspended.
 * Runs inside AuthJWTGuard (every protected route) right after the JWT is
 * validated; the store status is reloaded with the user on every request,
 * so a suspension applies at once. Routes marked @AllowSuspendedStore() pass.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_SUSPENDED_STORE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ user?: SubscriptionUser }>().user;
    assertStoreNotSuspended(user);

    return true;
  }
}
