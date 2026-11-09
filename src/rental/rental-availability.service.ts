import { Injectable } from '@nestjs/common';
import { Prisma } from '@generated/client';
import { RentalCleaningStatus, RentalStatus } from '@generated/enums';
import { addLocalDays, rentalBoundary } from './rental-days';

/**
 * Units of one variant busy on `[from, to)`: by a rental (`rentalId`) or by a
 * planned dry cleaning (`cleaningId`, R13) — exactly one of the two is set.
 */
export interface Occupancy {
  variantId: string;
  rentalId: string | null;
  cleaningId: string | null;
  from: Date;
  to: Date;
  quantity: number;
  /**
   * Not returned after its end date: `to` is only "now", the real return
   * moment is unknown (set by `findOccupancy`, used by the next-free search).
   */
  overdue?: boolean;
}

export interface VariantAvailability {
  variantId: string;
  owned: number;
  available: number;
}

/** Rentals whose items still hold or may hold units. */
const ACTIVE_STATUSES: RentalStatus[] = [
  RentalStatus.BOOKED,
  RentalStatus.ISSUED,
  RentalStatus.PARTIALLY_RETURNED,
  RentalStatus.RETURNED,
];

type Db = Prisma.TransactionClient;

/**
 * Peak number of units busy at the same moment inside `[from, to)` (R1):
 * two back-to-back bookings inside a long range take one unit, not two.
 * Intervals are half-open, so a unit freed at 12:00 can be taken at 12:00.
 */
export function peakOccupancy(
  intervals: { from: Date; to: Date; quantity: number }[],
  range: { from: Date; to: Date },
): number {
  const events: { at: number; delta: number }[] = [];
  for (const i of intervals) {
    const from = Math.max(i.from.getTime(), range.from.getTime());
    const to = Math.min(i.to.getTime(), range.to.getTime());
    if (from >= to || i.quantity <= 0) continue;
    events.push(
      { at: from, delta: i.quantity },
      { at: to, delta: -i.quantity },
    );
  }
  // Releases before takes at the same instant
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const e of events) {
    current += e.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

/**
 * Availability of rental variants on a warehouse (R1). Renting never changes
 * `Inventory.quantity`: it is the number of units the salon owns.
 */
@Injectable()
export class RentalAvailabilityService {
  /**
   * Locks the inventory rows of the variants until the transaction ends, so
   * two sellers cannot book the last unit for the same dates.
   */
  async lockInventory(db: Db, warehouseId: string, variantIds: string[]) {
    if (variantIds.length === 0) return;
    await db.$queryRaw`
      SELECT id FROM "inventories"
      WHERE "warehouseId" = ${warehouseId} AND "variantId" = ANY(${variantIds}::text[])
      ORDER BY id
      FOR UPDATE`;
  }

  /**
   * Busy intervals of the variants overlapping `range`:
   * - not returned units: `[startDate, max(endDate, now))` — an overdue item keeps its unit;
   * - returned units: `[startDate, availableFrom)` — includes dry cleaning;
   * - cancelled rentals hold nothing;
   * - an active planned dry cleaning (R13): one unit on `[startDate, endDate)`.
   */
  async findOccupancy(
    db: Db,
    params: {
      warehouseId: string;
      variantIds: string[];
      range: { from: Date; to: Date };
      excludeRentalId?: string;
      now?: Date;
    },
  ): Promise<Occupancy[]> {
    const now = params.now ?? new Date();
    if (params.variantIds.length === 0) return [];
    const items = await db.orderItem.findMany({
      where: {
        variantId: { in: params.variantIds },
        order: {
          rental: {
            warehouseId: params.warehouseId,
            status: { in: ACTIVE_STATUSES },
            startDate: { lt: params.range.to },
            // Skip history: only rentals that may still hold a unit in the range
            OR: [
              { endDate: { gt: params.range.from } },
              {
                status: {
                  in: [
                    RentalStatus.BOOKED,
                    RentalStatus.ISSUED,
                    RentalStatus.PARTIALLY_RETURNED,
                  ],
                },
              },
              {
                returns: {
                  some: {
                    items: {
                      some: { availableFrom: { gt: params.range.from } },
                    },
                  },
                },
              },
            ],
            ...(params.excludeRentalId
              ? { id: { not: params.excludeRentalId } }
              : {}),
          },
        },
      },
      select: {
        variantId: true,
        quantity: true,
        rentalReturnItems: { select: { quantity: true, availableFrom: true } },
        order: {
          select: {
            rental: { select: { id: true, startDate: true, endDate: true } },
          },
        },
      },
    });

    const result: Occupancy[] = [];
    for (const item of items) {
      const rental = item.order.rental;
      if (!rental) continue;
      let returned = 0;
      for (const r of item.rentalReturnItems) {
        returned += r.quantity;
        result.push({
          variantId: item.variantId,
          rentalId: rental.id,
          cleaningId: null,
          from: rental.startDate,
          to: r.availableFrom,
          quantity: r.quantity,
          overdue: false,
        });
      }
      const outstanding = item.quantity - returned;
      if (outstanding > 0) {
        result.push({
          variantId: item.variantId,
          rentalId: rental.id,
          cleaningId: null,
          from: rental.startDate,
          to: new Date(Math.max(rental.endDate.getTime(), now.getTime())),
          quantity: outstanding,
          overdue: rental.endDate.getTime() <= now.getTime(),
        });
      }
    }

    const cleanings = await db.rentalCleaning.findMany({
      where: {
        warehouseId: params.warehouseId,
        variantId: { in: params.variantIds },
        status: RentalCleaningStatus.ACTIVE,
        startDate: { lt: params.range.to },
        endDate: { gt: params.range.from },
      },
      select: { id: true, variantId: true, startDate: true, endDate: true },
    });
    for (const c of cleanings) {
      result.push({
        variantId: c.variantId,
        rentalId: null,
        cleaningId: c.id,
        from: c.startDate,
        to: c.endDate,
        quantity: 1,
        overdue: false,
      });
    }

    // An overdue unit is kept even when "now" is before the range: callers
    // that look ahead (next-free search) treat it as busy with no end
    return result.filter(
      (o) => o.overdue || o.to.getTime() > params.range.from.getTime(),
    );
  }

  /** Owned and free units per variant on `[from, to)`. */
  async getAvailability(
    db: Db,
    params: {
      warehouseId: string;
      variantIds: string[];
      range: { from: Date; to: Date };
      excludeRentalId?: string;
      now?: Date;
    },
  ): Promise<VariantAvailability[]> {
    const inventories = await db.inventory.findMany({
      where: {
        warehouseId: params.warehouseId,
        variantId: { in: params.variantIds },
      },
      select: { variantId: true, quantity: true },
    });
    const owned = new Map(inventories.map((i) => [i.variantId, i.quantity]));
    const occupancy = await this.findOccupancy(db, params);
    return params.variantIds.map((variantId) => {
      const own = owned.get(variantId) ?? 0;
      const busy = peakOccupancy(
        occupancy.filter((o) => o.variantId === variantId),
        params.range,
      );
      return { variantId, owned: own, available: Math.max(0, own - busy) };
    });
  }

  /**
   * Earliest start date in `[firstStart, lastStart]` (local `YYYY-MM-DD`)
   * from which a booking of `days` days finds a free unit, per variant;
   * `null` when there is none in the window. A unit still out after its end
   * date has no known return moment, so it stays busy for the whole search.
   */
  async findNextFreeStart(
    db: Db,
    params: {
      warehouseId: string;
      variantIds: string[];
      firstStart: string;
      lastStart: string;
      days: number;
      excludeRentalId?: string;
      now?: Date;
    },
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (params.firstStart > params.lastStart) {
      params.variantIds.forEach((id) => result.set(id, null));
      return result;
    }
    const range = {
      from: rentalBoundary(params.firstStart),
      to: rentalBoundary(addLocalDays(params.lastStart, params.days)),
    };
    const inventories = await db.inventory.findMany({
      where: {
        warehouseId: params.warehouseId,
        variantId: { in: params.variantIds },
      },
      select: { variantId: true, quantity: true },
    });
    const owned = new Map(inventories.map((i) => [i.variantId, i.quantity]));
    const occupancy = (
      await this.findOccupancy(db, {
        warehouseId: params.warehouseId,
        variantIds: params.variantIds,
        range,
        excludeRentalId: params.excludeRentalId,
        now: params.now,
      })
    ).map((o) => (o.overdue ? { ...o, to: range.to } : o));

    for (const variantId of params.variantIds) {
      const own = owned.get(variantId) ?? 0;
      const intervals = occupancy.filter((o) => o.variantId === variantId);
      let found: string | null = null;
      for (
        let start = params.firstStart;
        own > 0 && start <= params.lastStart;
        start = addLocalDays(start, 1)
      ) {
        const busy = peakOccupancy(intervals, {
          from: rentalBoundary(start),
          to: rentalBoundary(addLocalDays(start, params.days)),
        });
        if (busy < own) {
          found = start;
          break;
        }
      }
      result.set(variantId, found);
    }
    return result;
  }
}
