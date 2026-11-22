import {
  addLocalDays,
  localDateAt,
  plannedDays,
  rentalBoundary,
  rentalDays,
  toLocalDate,
} from './rental-days';

// Asia/Tashkent is UTC+5 all year
const at = (iso: string) => new Date(iso);

describe('rental-days', () => {
  it('puts the booking boundary at noon Tashkent time', () => {
    expect(rentalBoundary('2027-05-14').toISOString()).toBe(
      '2027-05-14T07:00:00.000Z',
    );
    expect(localDateAt('2027-05-14', 0).toISOString()).toBe(
      '2027-05-13T19:00:00.000Z',
    );
  });

  it('reads the local date, not the UTC one', () => {
    // 20:00 UTC on the 13th is already the 14th in Tashkent
    expect(toLocalDate(at('2027-05-13T20:00:00Z'))).toBe('2027-05-14');
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => rentalBoundary('14.05.2027')).toThrow();
    expect(() => rentalBoundary('2027-02-30')).toThrow();
  });

  it('prices a booking by calendar days', () => {
    expect(
      plannedDays(rentalBoundary('2027-05-14'), rentalBoundary('2027-05-16')),
    ).toBe(2);
  });

  describe('rentalDays (noon rule)', () => {
    const start = rentalBoundary('2027-05-14');

    it('does not count the day of a return before noon', () => {
      // 16th 11:00 Tashkent
      expect(rentalDays(start, at('2027-05-16T06:00:00Z'))).toBe(2);
    });

    it('treats a return at 12:00 sharp as on time', () => {
      expect(rentalDays(start, at('2027-05-16T07:00:00Z'))).toBe(2);
    });

    it('counts the day of a return after noon', () => {
      // 16th 12:01 and 15:00 Tashkent
      expect(rentalDays(start, at('2027-05-16T07:01:00Z'))).toBe(3);
      expect(rentalDays(start, at('2027-05-16T10:00:00Z'))).toBe(3);
    });

    it('charges at least one day', () => {
      // Returned on the day of issue, in the morning
      expect(rentalDays(start, at('2027-05-14T04:00:00Z'))).toBe(1);
    });
  });

  it('adds days across month ends', () => {
    expect(addLocalDays('2027-05-31', 1)).toBe('2027-06-01');
    expect(addLocalDays('2027-03-01', -1)).toBe('2027-02-28');
  });
});
