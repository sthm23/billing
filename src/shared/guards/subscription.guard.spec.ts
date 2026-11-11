import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StoreStatus, StoreSuspendReason, UserRole } from '@generated/enums';
import {
  STORE_SUSPENDED_CODE,
  SubscriptionGuard,
  SubscriptionUser,
  assertStoreNotSuspended,
} from './subscription.guard';

function userOf(
  status: StoreStatus,
  role: UserRole = UserRole.USER,
): SubscriptionUser {
  return {
    role,
    staff: {
      store: {
        name: 'Ёғоч',
        status,
        suspendedAt: new Date('2026-12-05T00:00:00Z'),
        suspendReason: StoreSuspendReason.UNPAID,
      },
    },
  };
}

function ctx(user: SubscriptionUser | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('assertStoreNotSuspended', () => {
  it('passes TRIAL / ACTIVE stores, admins and users without a store', () => {
    expect(() =>
      assertStoreNotSuspended(userOf(StoreStatus.TRIAL)),
    ).not.toThrow();
    expect(() =>
      assertStoreNotSuspended(userOf(StoreStatus.ACTIVE)),
    ).not.toThrow();
    expect(() =>
      assertStoreNotSuspended(userOf(StoreStatus.SUSPENDED, UserRole.ADMIN)),
    ).not.toThrow();
    expect(() =>
      assertStoreNotSuspended({ role: UserRole.USER, staff: null }),
    ).not.toThrow();
  });

  it('blocks owner and staff of a suspended store with STORE_SUSPENDED', () => {
    for (const role of [UserRole.OWNER, UserRole.USER]) {
      try {
        assertStoreNotSuspended(userOf(StoreStatus.SUSPENDED, role));
        fail('expected 403');
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect((e as ForbiddenException).getResponse()).toMatchObject({
          code: STORE_SUSPENDED_CODE,
          store: { name: 'Ёғоч', reason: StoreSuspendReason.UNPAID },
        });
      }
    }
  });
});

describe('SubscriptionGuard', () => {
  it('skips routes marked @AllowSuspendedStore()', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) };
    const guard = new SubscriptionGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(ctx(userOf(StoreStatus.SUSPENDED)))).toBe(true);
  });

  it('blocks other routes of a suspended store', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };
    const guard = new SubscriptionGuard(reflector as unknown as Reflector);

    expect(() => guard.canActivate(ctx(userOf(StoreStatus.SUSPENDED)))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(ctx(userOf(StoreStatus.ACTIVE)))).toBe(true);
  });
});
