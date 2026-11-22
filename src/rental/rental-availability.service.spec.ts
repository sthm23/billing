import { Prisma } from '@generated/client';
import {
  peakOccupancy,
  RentalAvailabilityService,
} from './rental-availability.service';
import { rentalBoundary } from './rental-days';

const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const DRESS = '55555555-5555-4555-8555-555555555555';
const day = (d: string) => rentalBoundary(d);

describe('peakOccupancy', () => {
  const range = { from: day('2027-05-10'), to: day('2027-05-20') };

  it('counts back-to-back bookings as one unit', () => {
    // 14 → 16 and 16 → 18: the dress returned at 12:00 is taken at 12:00
    expect(
      peakOccupancy(
        [
          { from: day('2027-05-14'), to: day('2027-05-16'), quantity: 1 },
          { from: day('2027-05-16'), to: day('2027-05-18'), quantity: 1 },
        ],
        range,
      ),
    ).toBe(1);
  });

  it('adds up overlapping bookings', () => {
    expect(
      peakOccupancy(
        [
          { from: day('2027-05-14'), to: day('2027-05-16'), quantity: 1 },
          { from: day('2027-05-15'), to: day('2027-05-18'), quantity: 2 },
        ],
        range,
      ),
    ).toBe(3);
  });

  it('ignores bookings outside the range', () => {
    expect(
      peakOccupancy(
        [{ from: day('2027-05-01'), to: day('2027-05-10'), quantity: 1 }],
        range,
      ),
    ).toBe(0);
  });
});

describe('RentalAvailabilityService', () => {
  const service = new RentalAvailabilityService();
  const db = {
    orderItem: { findMany: jest.fn() },
    inventory: { findMany: jest.fn() },
    rentalCleaning: { findMany: jest.fn() },
  };
  const rental = {
    id: 'rental-a',
    startDate: day('2027-05-14'),
    endDate: day('2027-05-16'),
  };
  const call = (range: { from: Date; to: Date }, now: Date) =>
    service.getAvailability(db as unknown as Prisma.TransactionClient, {
      warehouseId: WAREHOUSE,
      variantIds: [DRESS],
      range,
      now,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    db.inventory.findMany.mockResolvedValue([
      { variantId: DRESS, quantity: 1 },
    ]);
    db.rentalCleaning.findMany.mockResolvedValue([]);
  });

  it('keeps a unit busy during a planned dry cleaning (R13), freeing it at noon after the last day', async () => {
    db.orderItem.findMany.mockResolvedValue([]);
    db.rentalCleaning.findMany.mockResolvedValue([
      {
        id: 'cleaning-a',
        variantId: DRESS,
        startDate: day('2027-05-18'),
        endDate: day('2027-05-19'),
      },
    ]);
    const now = day('2027-05-01');
    const [onThe18th] = await call(
      { from: day('2027-05-17'), to: day('2027-05-19') },
      now,
    );
    expect(onThe18th.available).toBe(0);
    const [from19th] = await call(
      { from: day('2027-05-19'), to: day('2027-05-21') },
      now,
    );
    expect(from19th.available).toBe(1);
    const [{ where }] = db.rentalCleaning.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(where).toEqual(
      expect.objectContaining({
        warehouseId: WAREHOUSE,
        status: 'ACTIVE',
        startDate: { lt: day('2027-05-19') },
        endDate: { gt: day('2027-05-17') },
      }),
    );
  });

  it('frees the unit on the end date for the next booking', async () => {
    db.orderItem.findMany.mockResolvedValue([
      {
        variantId: DRESS,
        quantity: 1,
        rentalReturnItems: [],
        order: { rental },
      },
    ]);
    const [res] = await call(
      { from: day('2027-05-16'), to: day('2027-05-18') },
      day('2027-05-01'),
    );
    expect(res).toEqual({ variantId: DRESS, owned: 1, available: 1 });
  });

  it('keeps an overdue item busy until now', async () => {
    db.orderItem.findMany.mockResolvedValue([
      {
        variantId: DRESS,
        quantity: 1,
        rentalReturnItems: [],
        order: { rental },
      },
    ]);
    // Not returned yet on the 17th
    const [res] = await call(
      { from: day('2027-05-16'), to: day('2027-05-18') },
      day('2027-05-17'),
    );
    expect(res.available).toBe(0);
  });

  it('keeps a returned item busy during dry cleaning', async () => {
    db.orderItem.findMany.mockResolvedValue([
      {
        variantId: DRESS,
        quantity: 1,
        // Returned on the 16th 11:00 + 1 day of cleaning
        rentalReturnItems: [
          { quantity: 1, availableFrom: new Date('2027-05-17T06:00:00Z') },
        ],
        order: { rental },
      },
    ]);
    const now = day('2027-05-16');
    const [onThe16th] = await call(
      { from: day('2027-05-16'), to: day('2027-05-18') },
      now,
    );
    expect(onThe16th.available).toBe(0);
    const [onThe17th] = await call(
      { from: day('2027-05-17'), to: day('2027-05-19') },
      now,
    );
    expect(onThe17th.available).toBe(1);
  });

  it('counts only the not returned part of a partially returned line', async () => {
    db.inventory.findMany.mockResolvedValue([
      { variantId: DRESS, quantity: 3 },
    ]);
    db.orderItem.findMany.mockResolvedValue([
      {
        variantId: DRESS,
        quantity: 2,
        rentalReturnItems: [{ quantity: 1, availableFrom: day('2027-05-15') }],
        order: { rental },
      },
    ]);
    const [res] = await call(
      { from: day('2027-05-15'), to: day('2027-05-16') },
      day('2027-05-15'),
    );
    expect(res.available).toBe(2);
  });

  it('excludes the edited booking and cancelled rentals in the query', async () => {
    db.orderItem.findMany.mockResolvedValue([]);
    await service.getAvailability(db as unknown as Prisma.TransactionClient, {
      warehouseId: WAREHOUSE,
      variantIds: [DRESS],
      range: { from: day('2027-05-14'), to: day('2027-05-16') },
      excludeRentalId: 'rental-a',
    });
    const where = db.orderItem.findMany.mock.calls[0][0].where;
    expect(where.order.rental.id).toEqual({ not: 'rental-a' });
    expect(where.order.rental.status.in).not.toContain('CANCELLED');
    expect(where.order.rental.warehouseId).toBe(WAREHOUSE);
  });
});

describe('RentalAvailabilityService.findNextFreeStart', () => {
  const service = new RentalAvailabilityService();
  const db = {
    orderItem: { findMany: jest.fn() },
    inventory: { findMany: jest.fn() },
    rentalCleaning: { findMany: jest.fn() },
  };
  const booking = (start: string, end: string) => ({
    variantId: DRESS,
    quantity: 1,
    rentalReturnItems: [],
    order: {
      rental: { id: `r-${start}`, startDate: day(start), endDate: day(end) },
    },
  });
  const find = (now: Date, firstStart = '2027-05-15', days = 2) =>
    service
      .findNextFreeStart(db as unknown as Prisma.TransactionClient, {
        warehouseId: WAREHOUSE,
        variantIds: [DRESS],
        firstStart,
        lastStart: '2027-06-30',
        days,
        now,
      })
      .then((m) => m.get(DRESS));

  beforeEach(() => {
    jest.clearAllMocks();
    db.inventory.findMany.mockResolvedValue([
      { variantId: DRESS, quantity: 1 },
    ]);
    db.rentalCleaning.findMany.mockResolvedValue([]);
  });

  it('returns the first start with a free unit for the whole period', async () => {
    // 14 → 17 busy, 18 → 19 busy: a 2-day booking fits only from the 19th
    db.orderItem.findMany.mockResolvedValue([
      booking('2027-05-14', '2027-05-17'),
      booking('2027-05-18', '2027-05-19'),
    ]);
    expect(await find(day('2027-05-01'))).toBe('2027-05-19');
  });

  it('counts a planned dry cleaning as busy', async () => {
    db.orderItem.findMany.mockResolvedValue([]);
    db.rentalCleaning.findMany.mockResolvedValue([
      {
        id: 'c',
        variantId: DRESS,
        startDate: day('2027-05-15'),
        endDate: day('2027-05-16'),
      },
    ]);
    expect(await find(day('2027-05-01'))).toBe('2027-05-16');
  });

  it('never frees a unit that is still out after its end date', async () => {
    db.orderItem.findMany.mockResolvedValue([
      booking('2027-05-10', '2027-05-12'),
    ]);
    expect(await find(day('2027-05-14'))).toBeNull();
  });

  it('returns null when the salon owns no unit', async () => {
    db.inventory.findMany.mockResolvedValue([]);
    db.orderItem.findMany.mockResolvedValue([]);
    expect(await find(day('2027-05-01'))).toBeNull();
  });
});
