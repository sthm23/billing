import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@generated/client';
import { OrderStatus, RentalStatus } from '@generated/enums';
import { addDaysToInstant, rentalDays } from './rental-days';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

export interface ReturnOrderItem {
  id: string;
  variantId: string;
  quantity: number;
  retailPrice: Decimal;
  sale: Decimal;
  /** Already returned by earlier return events */
  returnedQuantity: number;
}

export interface ReturnSettlementInput {
  rental: { startDate: Date; endDate: Date; plannedDays: number };
  items: ReturnOrderItem[];
  totalAmount: Decimal;
  paidAmount: Decimal;
  returnedAt: Date;
  lines: { orderItemId: string; quantity: number; cleaningDays: number }[];
  penaltyAmount: Decimal;
  penaltyComment?: string;
  earlyReturnRefund: Decimal;
  /** Money the customer pays with this return */
  paymentsAmount: Decimal;
}

export interface ReturnSettlement {
  items: {
    orderItemId: string;
    variantId: string;
    quantity: number;
    cleaningDays: number;
    availableFrom: Date;
    plannedDays: number;
    /** Hint only (R2, R4): the total does not change by itself */
    actualDays: number;
  }[];
  penaltyAmount: Decimal;
  earlyReturnRefund: Decimal;
  /** Highest earlyReturnRefund allowed for these items, 0 if not an early return */
  maxEarlyReturnRefund: Decimal;
  /** Days past the planned period (hint for the manual penalty, R4) */
  overdueDays: number;
  /**
   * Hint: list day price (retailPrice / plannedDays, before discount) ×
   * returned units × overdueDays. Never added to the total by itself.
   */
  suggestedPenalty: Decimal;
  /** Planned days not used on an early return, 0 otherwise */
  unusedDays: number;
  /**
   * Hint for earlyReturnRefund: paid day price ((retailPrice − sale) /
   * plannedDays) × returned units × unusedDays, rounded down, ≤ maxEarlyReturnRefund.
   */
  unusedDaysAmount: Decimal;
  newTotalAmount: Decimal;
  /** Paid before this return */
  paidAmount: Decimal;
  paymentsAmount: Decimal;
  /** Still owed by the customer after this return */
  dueAmount: Decimal;
  /** Given back to the customer from the cashbox (early return of a paid rental) */
  cashOutAmount: Decimal;
  /** paidAmount of the order after this return */
  paidAmountAfter: Decimal;
  rentalStatusAfter: RentalStatus;
  orderStatusAfter: OrderStatus;
}

/**
 * Money and state of one return event (R4, R6, R7, R8, R10). Pure: the same
 * numbers back the preview and the real return.
 */
export function settleReturn(input: ReturnSettlementInput): ReturnSettlement {
  const itemById = new Map(input.items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const returnedNow = new Map<string, number>();
  let returnedValue = new Decimal(0);
  /** Sum of list day prices of the returned units */
  let listDayValue = new Decimal(0);
  /** Sum of paid day prices of the returned units */
  let paidDayValue = new Decimal(0);
  const plannedDays = Math.max(1, input.rental.plannedDays);
  const actualDays = rentalDays(input.rental.startDate, input.returnedAt);

  const items = input.lines.map((line) => {
    if (seen.has(line.orderItemId)) {
      throw new BadRequestException(
        `Order item listed twice: ${line.orderItemId}`,
      );
    }
    seen.add(line.orderItemId);
    const item = itemById.get(line.orderItemId);
    if (!item) {
      throw new BadRequestException(
        `Order item does not belong to this rental: ${line.orderItemId}`,
      );
    }
    const outstanding = item.quantity - item.returnedQuantity;
    if (line.quantity > outstanding) {
      throw new BadRequestException(
        `Cannot return ${line.quantity} of order item ${line.orderItemId}: only ${outstanding} not returned`,
      );
    }
    returnedNow.set(item.id, line.quantity);
    returnedValue = returnedValue.add(
      item.retailPrice.sub(item.sale).mul(line.quantity),
    );
    listDayValue = listDayValue.add(
      item.retailPrice.div(plannedDays).mul(line.quantity),
    );
    paidDayValue = paidDayValue.add(
      item.retailPrice.sub(item.sale).div(plannedDays).mul(line.quantity),
    );
    return {
      orderItemId: item.id,
      variantId: item.variantId,
      quantity: line.quantity,
      cleaningDays: line.cleaningDays,
      availableFrom: addDaysToInstant(input.returnedAt, line.cleaningDays),
      plannedDays: input.rental.plannedDays,
      actualDays,
    };
  });

  if (input.penaltyAmount.gt(0) && !input.penaltyComment?.trim()) {
    throw new BadRequestException(
      'penaltyComment is required when penaltyAmount is set',
    );
  }

  const isEarly = input.returnedAt.getTime() < input.rental.endDate.getTime();
  const maxEarlyReturnRefund = isEarly ? returnedValue : new Decimal(0);
  const overdueDays = Math.max(0, actualDays - input.rental.plannedDays);
  const unusedDays = isEarly
    ? Math.max(0, input.rental.plannedDays - actualDays)
    : 0;
  const suggestedPenalty = listDayValue
    .mul(overdueDays)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const unusedDaysAmount = Decimal.min(
    paidDayValue.mul(unusedDays).toDecimalPlaces(0, Decimal.ROUND_DOWN),
    maxEarlyReturnRefund,
  );
  if (input.earlyReturnRefund.gt(0)) {
    if (!isEarly) {
      throw new BadRequestException(
        'earlyReturnRefund is allowed only for a return before the end date',
      );
    }
    if (input.earlyReturnRefund.gt(maxEarlyReturnRefund)) {
      throw new BadRequestException(
        `earlyReturnRefund cannot exceed the price of the returned items (${maxEarlyReturnRefund.toString()})`,
      );
    }
  }

  const newTotalAmount = input.totalAmount
    .add(input.penaltyAmount)
    .sub(input.earlyReturnRefund);
  const paidWithPayments = input.paidAmount.add(input.paymentsAmount);
  let cashOutAmount = new Decimal(0);
  if (paidWithPayments.gt(newTotalAmount)) {
    if (input.paymentsAmount.gt(0)) {
      throw new BadRequestException('Payment amount exceeds order total');
    }
    cashOutAmount = paidWithPayments.sub(newTotalAmount);
  }
  const paidAmountAfter = paidWithPayments.sub(cashOutAmount);

  const allReturned = input.items.every(
    (i) => i.returnedQuantity + (returnedNow.get(i.id) ?? 0) >= i.quantity,
  );

  return {
    items,
    penaltyAmount: input.penaltyAmount,
    earlyReturnRefund: input.earlyReturnRefund,
    maxEarlyReturnRefund,
    overdueDays,
    suggestedPenalty,
    unusedDays,
    unusedDaysAmount,
    newTotalAmount,
    paidAmount: input.paidAmount,
    paymentsAmount: input.paymentsAmount,
    dueAmount: newTotalAmount.sub(paidAmountAfter),
    cashOutAmount,
    paidAmountAfter,
    rentalStatusAfter: allReturned
      ? RentalStatus.RETURNED
      : RentalStatus.PARTIALLY_RETURNED,
    orderStatusAfter: paidAmountAfter.gte(newTotalAmount)
      ? OrderStatus.COMPLETED
      : OrderStatus.DEBT,
  };
}
