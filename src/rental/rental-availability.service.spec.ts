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
