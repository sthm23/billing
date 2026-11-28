import { AUTH_THROTTLE } from '@auth/auth-throttle';
import type { ShopRequest } from './shop-context';

const MINUTE_MS = 60_000;

/**
 * Counted per customer (Telegram user) of one shop, not per IP: mobile operators put many
 * people behind one address. Runs after `TelegramShopGuard`, so the user is known; without
 * a verified user it falls back to the IP.
 */
const perCustomer = (req: Record<string, unknown>): string => {
  const shop = (req as ShopRequest).telegramShop;

  return shop ? `${shop.slug}:${shop.telegramUserId}` : String(req.ip);
};

/**
 * Overrides the `ip` throttler of `authThrottleOptions` (the `login` one is skipped).
 * Browsing: a Mini App screen makes a few requests, photos come from the bucket.
 */
export const PUBLIC_SHOP_THROTTLE = {
  [AUTH_THROTTLE.IP]: { limit: 120, ttl: MINUTE_MS, getTracker: perCustomer },
};

/** Sending requests to the store: a person does it a few times a day. */
export const ORDER_CREATE_THROTTLE = {
  [AUTH_THROTTLE.IP]: { limit: 10, ttl: MINUTE_MS, getTracker: perCustomer },
};
