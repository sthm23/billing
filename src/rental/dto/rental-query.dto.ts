import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { LOCAL_DATE } from './create-rental.dto';

const LOCAL_DATE_MESSAGE = '$property must be a date in YYYY-MM-DD format';
/** Comma-separated v4 UUIDs */
const UUID_LIST =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})*$/i;

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
}
