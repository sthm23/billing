import { IsDateString, IsOptional } from 'class-validator';

/**
 * Period of a summary: `[from, to)`. The client sends its local day bounds
 * (the server time zone may differ); both default to the server's today.
 */
export class DateRangeParams {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Resolves the period; without bounds — the current server day. */
export function resolveDateRange({ from, to }: DateRangeParams): {
  from: Date;
  to: Date;
} {
  const start = from ? new Date(from) : new Date();
  if (!from) start.setHours(0, 0, 0, 0);
  const end = to ? new Date(to) : new Date(start.getTime() + DAY_MS);
  return { from: start, to: end };
}
