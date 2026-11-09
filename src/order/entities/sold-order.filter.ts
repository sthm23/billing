import { Prisma } from '@generated/client';
import { OrderStatus } from '@generated/enums';

/**
 * Orders that count as sold (by `soldAt`): paid or on debt, plus rental
 * orders, which stay HOLD while active. Used by sales summaries.
 */
export const SOLD_ORDER_FILTER: Prisma.OrderWhereInput = {
  OR: [
    { status: { in: [OrderStatus.COMPLETED, OrderStatus.DEBT] } },
    { status: OrderStatus.HOLD, rental: { isNot: null } },
  ],
};
