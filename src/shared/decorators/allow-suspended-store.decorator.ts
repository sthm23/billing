import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_STORE_KEY = 'allowSuspendedStore';

/**
 * The route stays available while the user's store is suspended
 * (e.g. GET /auth/me — the app needs it to show «Магазин приостановлен»).
 */
export const AllowSuspendedStore = () =>
  SetMetadata(ALLOW_SUSPENDED_STORE_KEY, true);
