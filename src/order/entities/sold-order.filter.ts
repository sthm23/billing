import { Prisma } from '@generated/client';
import { OrderStatus } from '@generated/enums';

/**
 * Orders that count as sold (by `soldAt`): paid, on debt or returned, plus
 * rental orders, which stay HOLD while active. Used by sales summaries, which
 * count the net amount `totalAmount − returnedAmount` (a full return gives 0).
 */
export const SOLD_ORDER_FILTER: Prisma.OrderWhereInput = {
  OR: [
    {
      status: {
        in: [OrderStatus.COMPLETED, OrderStatus.DEBT, OrderStatus.REFUNDED],
      },
    },
    { status: OrderStatus.HOLD, rental: { isNot: null } },
  ],
};
