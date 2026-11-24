import { CashTransactionCategory, PaymentType } from '@generated/enums';

/** Reports group days and hours in the store's time zone. */
export const REPORT_TIME_ZONE = 'Asia/Tashkent';
/** Asia/Tashkent is UTC+5 all year (no daylight saving time), so buckets can be built with a fixed offset. */
export const REPORT_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Longest period of one dashboard request. */
export const MAX_PERIOD_DAYS = 31;

/** Payment methods in the order the dashboard shows them (ONLINE = «Click»). */
export const PAYMENT_TYPES_ORDER: PaymentType[] = [
  PaymentType.CASH,
  PaymentType.CARD,
  PaymentType.ONLINE,
  PaymentType.TRANSFER,
];

/** Store purchases are a separate cash-flow line, not a store expense. */
export const PURCHASE_CATEGORY = CashTransactionCategory.PURCHASE;
