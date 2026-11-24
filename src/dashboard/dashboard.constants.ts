import {
  CashTransactionCategory,
  PaymentType,
  RentalStatus,
  ReturnReason,
} from '@generated/enums';

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

export const HOURS_IN_DAY = 24;

/** The «Продажи по складам» card needs at least two warehouses. */
export const MIN_WAREHOUSES_FOR_SPLIT = 2;

/** Return reasons in the order the dashboard shows them. */
export const RETURN_REASONS_ORDER: ReturnReason[] = [
  ReturnReason.DEFECT,
  ReturnReason.NOT_FIT,
  ReturnReason.EXTRA,
  ReturnReason.OTHER,
];

/** Rentals whose items are with the customer (same as the rental lists' «out»). */
export const RENTAL_OUT_STATUSES: RentalStatus[] = [
  RentalStatus.ISSUED,
  RentalStatus.PARTIALLY_RETURNED,
];

/** Store purchases are a separate cash-flow line, not a store expense. */
export const PURCHASE_CATEGORY = CashTransactionCategory.PURCHASE;
