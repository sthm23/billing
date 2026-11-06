import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { LOCAL_DATE } from './create-rental.dto';

const LOCAL_DATE_MESSAGE = '$property must be a date in YYYY-MM-DD format';
/** Comma-separated v4 UUIDs */
const UUID_LIST =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})*$/i;

/** Fields the rental list can be sorted by */
export const RENTAL_SORT_FIELDS = ['startDate', 'endDate'] as const;
export type RentalSortField = (typeof RENTAL_SORT_FIELDS)[number];

/** GET /rental/availability — query values stay strings (no transform pipe) */
export class RentalAvailabilityQuery {
  @IsUUID('4')
  warehouseId!: string;

  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  startDate!: string;

  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  endDate!: string;

  @Matches(UUID_LIST, { message: 'variantIds must be comma-separated UUIDs' })
  variantIds!: string;

  /** When editing a booking: do not count the booking itself */
  @IsOptional()
  @IsUUID('4')
  excludeRentalId?: string;
}

/** GET /rental/calendar */
export class RentalCalendarQuery {
  @IsUUID('4')
  warehouseId!: string;

  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  from!: string;

  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  to!: string;

  /** Default — every rentable variant of the warehouse */
  @IsOptional()
  @Matches(UUID_LIST, { message: 'variantIds must be comma-separated UUIDs' })
  variantIds?: string;
}

/**
 * Quick filters: issueToday — booked and can be issued today; returnToday —
 * with the customer, due back today; overdue — with the customer past the end;
 * booked; out — with the customer; all.
 */
export const RENTAL_VIEWS = [
  'issueToday',
  'returnToday',
  'overdue',
  'booked',
  'out',
  'all',
] as const;
export type RentalView = (typeof RENTAL_VIEWS)[number];

/** GET /rental */
export class RentalListQuery {
  @IsOptional()
  @IsNumberString()
  pageSize?: string;

  @IsOptional()
  @IsNumberString()
  currentPage?: string;

  /** Comma-separated RentalStatus values */
  @IsOptional()
  @IsString()
  status?: string;

  /** Rentals overlapping [from, to] (local dates) */
  @IsOptional()
  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  to?: string;

  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  /** Issued, not fully returned, end date passed */
  @IsOptional()
  @IsIn(['true', 'false'])
  overdue?: string;

  /** Quick filter of the mobile list (see RENTAL_VIEWS) */
  @IsOptional()
  @IsIn(RENTAL_VIEWS)
  view?: RentalView;

  /** Customer name, phone digits or the short rental code */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;

  /** Rentals that include this variant */
  @IsOptional()
  @IsUUID('4')
  variantId?: string;

  /** Sort direction; default desc */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';

  /** Sort field; default startDate (endDate = by planned return) */
  @IsOptional()
  @IsIn(RENTAL_SORT_FIELDS)
  sortBy?: RentalSortField;
}

/** GET /rental/similar — replacements for a variant busy on the dates */
export class RentalSimilarQuery {
  @IsUUID('4')
  warehouseId!: string;

  @IsUUID('4')
  variantId!: string;

  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  startDate!: string;

  @Matches(LOCAL_DATE, { message: LOCAL_DATE_MESSAGE })
  endDate!: string;

  /** When editing a booking: do not count the booking itself */
  @IsOptional()
  @IsUUID('4')
  excludeRentalId?: string;
}
