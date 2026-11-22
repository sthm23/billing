import { Prisma } from '@generated/client';
import { OrderStatus, RentalStatus } from '@generated/enums';
import { rentalBoundary } from './rental-days';
import { ReturnSettlementInput, settleReturn } from './rental-return';

const D = (v: number | string) => new Prisma.Decimal(v);
const at = (iso: string) => new Date(iso);

// Wedding example (02_RENTAL_WORKFLOWS.md): dress 200 000/day, suit 150 000/day,
// makeup 900 000, booked 14 → 16 May (2 days), total 1 600 000
const DRESS_ITEM = 'dress-item';
const SUIT_ITEM = 'suit-item';

function input(
  extra: Partial<ReturnSettlementInput> = {},
): ReturnSettlementInput {
  return {
    rental: {
      startDate: rentalBoundary('2027-05-14'),
      endDate: rentalBoundary('2027-05-16'),
      plannedDays: 2,
    },
    items: [
      {
        id: DRESS_ITEM,
        variantId: 'dress',
        quantity: 1,
        retailPrice: D(400000),
        sale: D(0),
        returnedQuantity: 0,
      },
      {
        id: SUIT_ITEM,
        variantId: 'suit',
        quantity: 1,
        retailPrice: D(300000),
        sale: D(0),
        returnedQuantity: 0,
      },
    ],
    totalAmount: D(1600000),
    paidAmount: D(500000),
    // 16th 11:00 Tashkent
    returnedAt: at('2027-05-16T06:00:00Z'),
    lines: [
      { orderItemId: DRESS_ITEM, quantity: 1, cleaningDays: 1 },
      { orderItemId: SUIT_ITEM, quantity: 1, cleaningDays: 0 },
    ],
    penaltyAmount: D(0),
    earlyReturnRefund: D(0),
    paymentsAmount: D(0),
    ...extra,
  };
}

describe('settleReturn', () => {
  it('late return: overdue days and the list-price penalty are hints only', () => {
    // 17th 15:00 Tashkent: 14th → 17th after noon = 4 days, planned 2
    const res = settleReturn(input({ returnedAt: at('2027-05-17T10:00:00Z') }));
    expect(res.overdueDays).toBe(2);
    // (400 000 / 2 + 300 000 / 2) × 2 days
    expect(res.suggestedPenalty.toNumber()).toBe(700000);
    expect(res.unusedDays).toBe(0);
    expect(res.unusedDaysAmount.toNumber()).toBe(0);
    // Nothing is added to the total by itself
    expect(res.newTotalAmount.toNumber()).toBe(1600000);
  });

  it('early return: unused days at the paid day price, capped by the returned value', () => {
    const res = settleReturn(
      input({
        items: [
          {
            id: DRESS_ITEM,
            variantId: 'dress',
            quantity: 1,
            retailPrice: D(400000),
            sale: D(50001),
            returnedQuantity: 0,
          },
          {
            id: SUIT_ITEM,
            variantId: 'suit',
            quantity: 1,
            retailPrice: D(300000),
            sale: D(0),
            returnedQuantity: 0,
          },
        ],
        // 15th 10:00 Tashkent: 1 day used of 2
        returnedAt: at('2027-05-15T05:00:00Z'),
      }),
    );
    expect(res.overdueDays).toBe(0);
    expect(res.suggestedPenalty.toNumber()).toBe(0);
    expect(res.unusedDays).toBe(1);
    // (349 999 / 2 + 300 000 / 2) × 1 = 324 999.5 → rounded down
    expect(res.unusedDaysAmount.toNumber()).toBe(324999);
    expect(res.unusedDaysAmount.lte(res.maxEarlyReturnRefund)).toBe(true);
  });
  it('full return on time: RETURNED, the rest is a debt', () => {
    const res = settleReturn(input());
    expect(res.items[0]).toMatchObject({ plannedDays: 2, actualDays: 2 });
    // Dress back in the salon after one day of cleaning, suit right away
    expect(res.items[0].availableFrom).toEqual(at('2027-05-17T06:00:00Z'));
    expect(res.items[1].availableFrom).toEqual(at('2027-05-16T06:00:00Z'));
    expect(Number(res.newTotalAmount)).toBe(1600000);
    expect(Number(res.dueAmount)).toBe(1100000);
    expect(res.rentalStatusAfter).toBe(RentalStatus.RETURNED);
    expect(res.orderStatusAfter).toBe(OrderStatus.DEBT);
  });

  it('pays the rest with the return: COMPLETED', () => {
    const res = settleReturn(input({ paymentsAmount: D(1100000) }));
    expect(Number(res.dueAmount)).toBe(0);
    expect(Number(res.paidAmountAfter)).toBe(1600000);
    expect(res.orderStatusAfter).toBe(OrderStatus.COMPLETED);
  });

  it('late return shows an extra day but keeps the total (R4)', () => {
    // 16th 15:00
    const res = settleReturn(input({ returnedAt: at('2027-05-16T10:00:00Z') }));
    expect(res.items[0]).toMatchObject({ plannedDays: 2, actualDays: 3 });
    expect(Number(res.newTotalAmount)).toBe(1600000);
  });

  it('adds a penalty to the total and requires a comment (R10)', () => {
    const res = settleReturn(
      input({ penaltyAmount: D(300000), penaltyComment: 'Torn hem' }),
    );
    expect(Number(res.newTotalAmount)).toBe(1900000);
    expect(() =>
      settleReturn(input({ penaltyAmount: D(300000), penaltyComment: ' ' })),
    ).toThrow('penaltyComment');
  });

  it('early return refund gives the overpaid money back (scenario 5a)', () => {
    // Booked 14 → 18, all paid, back on the 16th in the morning
    const res = settleReturn(
      input({
        rental: {
          startDate: rentalBoundary('2027-05-14'),
          endDate: rentalBoundary('2027-05-18'),
          plannedDays: 4,
        },
        items: [
          {
            id: DRESS_ITEM,
            variantId: 'dress',
            quantity: 1,
            retailPrice: D(800000),
            sale: D(0),
            returnedQuantity: 0,
          },
          {
            id: SUIT_ITEM,
            variantId: 'suit',
            quantity: 1,
            retailPrice: D(600000),
            sale: D(0),
            returnedQuantity: 0,
          },
        ],
        totalAmount: D(2000000),
        paidAmount: D(2000000),
        earlyReturnRefund: D(300000),
      }),
    );
    expect(res.items[0]).toMatchObject({ plannedDays: 4, actualDays: 2 });
    expect(Number(res.maxEarlyReturnRefund)).toBe(1400000);
    expect(Number(res.newTotalAmount)).toBe(1700000);
    expect(Number(res.cashOutAmount)).toBe(300000);
    expect(Number(res.paidAmountAfter)).toBe(1700000);
    expect(res.orderStatusAfter).toBe(OrderStatus.COMPLETED);
  });

  it('early return refund of an unpaid rental only lowers the debt', () => {
    const res = settleReturn(
      input({
        returnedAt: at('2027-05-15T06:00:00Z'),
        earlyReturnRefund: D(200000),
      }),
    );
    expect(Number(res.cashOutAmount)).toBe(0);
    expect(Number(res.dueAmount)).toBe(900000);
  });

  it('limits the early return refund to the returned items and to early returns', () => {
    expect(() =>
      settleReturn(
        input({
          returnedAt: at('2027-05-15T06:00:00Z'),
          lines: [{ orderItemId: SUIT_ITEM, quantity: 1, cleaningDays: 0 }],
          earlyReturnRefund: D(300001),
        }),
      ),
    ).toThrow('cannot exceed');
    // On the end date after noon it is not early
    expect(() =>
      settleReturn(
        input({
          returnedAt: at('2027-05-16T08:00:00Z'),
          earlyReturnRefund: D(1),
        }),
      ),
    ).toThrow('before the end date');
  });

  it('partial return: PARTIALLY_RETURNED, then RETURNED with the rest', () => {
    const first = settleReturn(
      input({
        lines: [{ orderItemId: DRESS_ITEM, quantity: 1, cleaningDays: 1 }],
      }),
    );
    expect(first.rentalStatusAfter).toBe(RentalStatus.PARTIALLY_RETURNED);
    expect(first.orderStatusAfter).toBe(OrderStatus.DEBT);

    const base = input();
    const second = settleReturn({
      ...base,
      items: base.items.map((i) =>
        i.id === DRESS_ITEM ? { ...i, returnedQuantity: 1 } : i,
      ),
      // 16th 14:30 — 3 days for the suit, the seller adds a penalty
      returnedAt: at('2027-05-16T09:30:00Z'),
      lines: [{ orderItemId: SUIT_ITEM, quantity: 1, cleaningDays: 1 }],
      penaltyAmount: D(150000),
      penaltyComment: 'Late 1 day',
    });
    expect(second.items[0].actualDays).toBe(3);
    expect(second.rentalStatusAfter).toBe(RentalStatus.RETURNED);
    expect(Number(second.newTotalAmount)).toBe(1750000);
  });

  it('rejects returning more than is out and foreign items', () => {
    const base = input();
    expect(() =>
      settleReturn({
        ...base,
        items: base.items.map((i) => ({ ...i, returnedQuantity: 1 })),
        lines: [{ orderItemId: DRESS_ITEM, quantity: 1, cleaningDays: 0 }],
      }),
    ).toThrow('only 0 not returned');
    expect(() =>
      settleReturn(
        input({
          lines: [{ orderItemId: 'other', quantity: 1, cleaningDays: 0 }],
        }),
      ),
    ).toThrow('does not belong');
    expect(() =>
      settleReturn(
        input({
          lines: [
            { orderItemId: DRESS_ITEM, quantity: 1, cleaningDays: 0 },
            { orderItemId: DRESS_ITEM, quantity: 1, cleaningDays: 0 },
          ],
        }),
      ),
    ).toThrow('listed twice');
  });

  it('rejects a payment above the new total', () => {
    expect(() => settleReturn(input({ paymentsAmount: D(1100001) }))).toThrow(
      'exceeds order total',
    );
  });
});
