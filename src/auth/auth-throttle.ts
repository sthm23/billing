import type { ThrottlerModuleOptions } from '@nestjs/throttler';

/** Throttler names, used in `@Throttle` / `@SkipThrottle` on auth routes. */
export const AUTH_THROTTLE = {
  /** All guarded auth requests (login + refresh) from one IP */
  IP: 'ip',
  /** Login attempts for one login from one IP (password guessing) */
  LOGIN: 'login',
} as const;

const MINUTE_MS = 60_000;

/**
 * Rate limits for the public auth routes. `ThrottlerGuard` is applied only on
 * `POST /login` and `GET /refresh` (not globally); the counters are kept in
 * memory (one app instance under PM2).
 */
export const authThrottleOptions: ThrottlerModuleOptions = {
  errorMessage: 'Too many attempts, try again later',
  throttlers: [
    { name: AUTH_THROTTLE.IP, ttl: MINUTE_MS, limit: 30 },
    {
      name: AUTH_THROTTLE.LOGIN,
      ttl: MINUTE_MS,
      limit: 5,
      // Per IP + login: a shop of staff behind one IP is not locked out by
      // one person's typos
      getTracker: (req: { ip?: string; body?: { login?: unknown } }) => {
        const raw = req.body?.login;
        const login = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        return `${req.ip}:${login}`;
      },
    },
  ],
};
