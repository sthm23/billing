import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '@prisma/prisma.service';
import { CurrentUser } from '@auth/models/auth.model';
import { Cashbox, Prisma } from '@generated/client';
import {
  CashTransactionCategory,
  CashTransactionType,
  OrderChannel,
  OrderStatus,
  PaymentType,
  RentalStatus,
  StaffRole,
  UserRole,
} from '@generated/enums';
import { resolvePaymentCashbox } from '../cashbox/payment-cashbox';
import { CreateRentalDto, UpdateRentalDto } from './dto/create-rental.dto';
import {
  CancelRentalDto,
  CleaningConflictsQuery,
  IssueRentalDto,
  MAX_CLEANING_DAYS,
  RentalReturnDto,
} from './dto/rental-lifecycle.dto';
import { CreateRentalPaymentDto } from './dto/rental-payment.dto';
import {
  RENTAL_VIEWS,
  RentalAvailabilityQuery,
  RentalCalendarQuery,
  RentalListQuery,
  RentalSimilarQuery,
  RentalView,
} from './dto/rental-query.dto';
import {
  Occupancy,
  peakOccupancy,
  RentalAvailabilityService,
} from './rental-availability.service';
import {
  addDaysToInstant,
  addLocalDays,
  plannedDays,
  rentalBoundary,
  todayLocalDate,
  toLocalDate,
} from './rental-days';
import { ReturnSettlement, settleReturn } from './rental-return';

type Db = Prisma.TransactionClient;
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/** Statuses in which the customer may pay (prepayment, extra payment) */
const PAYABLE_STATUSES: RentalStatus[] = [
  RentalStatus.BOOKED,
  RentalStatus.ISSUED,
  RentalStatus.PARTIALLY_RETURNED,
];
/** Items are with the customer */
const OUT_STATUSES: RentalStatus[] = [
  RentalStatus.ISSUED,
  RentalStatus.PARTIALLY_RETURNED,
];
const MAX_CALENDAR_DAYS = 93;
/** A search text that may be the start of a rental code (id prefix) */
const RENTAL_CODE_SEARCH = /^[0-9a-f]{4,8}$/i;
const MIN_PHONE_SEARCH_DIGITS = 3;
const RENTAL_CODE_LENGTH = 6;
const MAX_SIMILAR_VARIANTS = 20;

/** Short code shown to people and searched by: the first id characters */
export function rentalCode(id: string): string {
  return id.slice(0, RENTAL_CODE_LENGTH).toUpperCase();
}
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
/** Clock drift between the device and the server tolerated for returnedAt */
const RETURN_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

/** Rental fields a return is computed from */
const returnRentalSelect = {
  id: true,
  status: true,
  startDate: true,
  endDate: true,
  plannedDays: true,
  issuedAt: true,
  order: {
    select: {
      totalAmount: true,
      paidAmount: true,
      items: {
        select: {
          id: true,
          variantId: true,
          quantity: true,
          retailPrice: true,
          sale: true,
          rentalReturnItems: { select: { quantity: true } },
        },
      },
    },
  },
} satisfies Prisma.RentalSelect;
type ReturnRental = Prisma.RentalGetPayload<{
  select: typeof returnRentalSelect;
}>;

export interface CleaningConflict {
  orderItemId: string;
  variantId: string;
  availableFrom: Date;
  conflicts: {
    rentalId: string;
    orderId: string;
    customerName: string | null;
    startDate: string;
    endDate: string;
    /** Units the booking needs */
    quantity: number;
    /** Units free for it while the returned item is in cleaning */
    availableAtStart: number;
  }[];
}

/** `orderItemId:quantity:cleaningDays,...` of GET /rental/:id/cleaning-conflicts */
export function parseConflictItems(
  value: string,
): { orderItemId: string; quantity: number; cleaningDays: number }[] {
  const lines = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [orderItemId, quantity, cleaningDays] = part.split(':');
      const line = {
        orderItemId,
        quantity: Number(quantity),
        cleaningDays: Number(cleaningDays),
      };
      if (
        !orderItemId ||
        !Number.isInteger(line.quantity) ||
        line.quantity < 1 ||
        !Number.isInteger(line.cleaningDays) ||
        line.cleaningDays < 0 ||
        line.cleaningDays > MAX_CLEANING_DAYS
      ) {
        throw new BadRequestException(
          `Invalid item "${part}": expected orderItemId:quantity:cleaningDays`,
        );
      }
      return line;
    });
  if (lines.length === 0) {
    throw new BadRequestException('At least one item is required');
  }
  return lines;
}

/** Error codes of the rental API (docs/rental/03_RENTAL_API.md) */
export const RentalErrorCode = {
  RENTAL_DISABLED: 'RENTAL_DISABLED',
  VARIANT_NOT_RENTABLE: 'VARIANT_NOT_RENTABLE',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
} as const;

interface BookingLine {
  variantId: string;
  quantity: number;
  retailPrice: Decimal;
  sale: Decimal;
}

interface BookingService {
  name: string;
  price: Decimal;
  sale: Decimal;
  description: string | null;
}

interface PreparedBooking {
  startDate: Date;
  endDate: Date;
  plannedDays: number;
  lines: BookingLine[];
  services: BookingService[];
  totalAmount: Decimal;
}

const rentalDetailsInclude = {
  collaterals: { orderBy: { receivedAt: 'asc' } },
  returns: { include: { items: true }, orderBy: { returnedAt: 'asc' } },
  order: {
    include: {
      customer: {
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
        },
      },
      warehouse: { select: { id: true, name: true } },
      services: { orderBy: { createdAt: 'asc' } },
      payments: { orderBy: { createdAt: 'asc' } },
      items: {
        orderBy: { createdAt: 'asc' },
        // The purchase cost means nothing for a rental line
        omit: { costAtSale: true },
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              barCode: true,
              rentPricePerDay: true,
              defaultCleaningDays: true,
              product: { select: { id: true, name: true } },
              attributes: {
                include: {
                  value: {
                    include: { attribute: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.RentalInclude;

/**
 * Rental bookings (docs/rental/01_RENTAL_DESIGN.md). Money lives in the Order
 * (items, services, payments), dates and item state in the Rental.
 * Renting never changes Inventory and creates no StockMovement.
 */
@Injectable()
export class RentalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: RentalAvailabilityService,
    @InjectPinoLogger(RentalService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------- access

  private canManageStore(user: CurrentUser): boolean {
    return (
      user.role === UserRole.OWNER ||
      user.staff?.role === StaffRole.OWNER ||
      user.staff?.role === StaffRole.MANAGER
    );
  }

  private isStoreOwner(user: CurrentUser): boolean {
    return user.role === UserRole.OWNER || user.staff?.role === StaffRole.OWNER;
  }

  /** Staff of a store with rental enabled; returns the store id from the token. */
  private async assertRentalStore(user: CurrentUser): Promise<string> {
    if (!user.staff) throw new ForbiddenException('Staff only');
    const store = await this.prisma.store.findUnique({
      where: { id: user.staff.storeId },
      select: { rentalEnabled: true },
    });
    if (!store?.rentalEnabled) {
      throw new BadRequestException({
        code: RentalErrorCode.RENTAL_DISABLED,
        message: 'Rental is disabled for this store',
      });
    }
    return user.staff.storeId;
  }

  /** The owner works with every warehouse of the store, others with their own. */
  private hasWarehouseAccess(user: CurrentUser, warehouseId: string): boolean {
    return (
      this.isStoreOwner(user) ||
      user.staff.warehouse.some((w) => w.warehouseId === warehouseId)
    );
  }

  private async assertWarehouse(
    user: CurrentUser,
    storeId: string,
    warehouseId: string,
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, storeId },
      select: { id: true },
    });
    if (!warehouse || !this.hasWarehouseAccess(user, warehouseId)) {
      throw new ForbiddenException('No access to this warehouse');
    }
  }

  private assertRentalAccess(
    rental: { storeId: string; warehouseId: string } | null,
    storeId: string,
    user: CurrentUser,
  ): asserts rental is { storeId: string; warehouseId: string } {
    if (!rental || rental.storeId !== storeId) {
      throw new NotFoundException('Rental not found');
    }
    if (!this.hasWarehouseAccess(user, rental.warehouseId)) {
      throw new ForbiddenException('No access to this rental');
    }
  }

  /** Logs and rethrows: HTTP errors as they are, anything else as 400. */
  private fail(
    error: unknown,
    context: Record<string, unknown>,
    message: string,
  ): never {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error({ ...context, err: err.message }, message);
    if (error instanceof HttpException) throw error;
    throw new BadRequestException(err.message);
  }

  // ----------------------------------------------------------------- dates

  /** Booking dates: noon of the local dates (R2); start before end. */
  private resolveDates(
    startDate: string,
    endDate: string,
    { allowPastStart }: { allowPastStart: boolean },
  ) {
    let start: Date;
    let end: Date;
    try {
      start = rentalBoundary(startDate);
      end = rentalBoundary(endDate);
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid date',
      );
    }
    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }
    if (!allowPastStart && startDate < todayLocalDate()) {
      throw new BadRequestException('startDate cannot be in the past');
    }
    return { start, end };
  }

  // --------------------------------------------------------------- booking

  /**
   * Validates a booking inside the transaction and prices it:
   * rentable variants (R1, R3), free units on the dates with the inventory
   * rows locked, discounts (only OWNER/MANAGER may lower the base price;
   * a seller may keep a discount already saved on the booking).
   */
  private async prepareBooking(
    tx: Db,
    dto: CreateRentalDto,
    user: CurrentUser,
    options: {
      storeId: string;
      allowPastStart: boolean;
      excludeRentalId?: string;
      savedLines?: { variantId: string; sale: Decimal }[];
    },
  ): Promise<PreparedBooking> {
    const { start, end } = this.resolveDates(dto.startDate, dto.endDate, {
      allowPastStart: options.allowPastStart,
    });
    const days = plannedDays(start, end);

    const variantIds = dto.items.map((i) => i.variantId);
    if (new Set(variantIds).size !== variantIds.length) {
      throw new BadRequestException(
        'Each variant may appear only once; use quantity instead',
      );
    }

    await this.availability.lockInventory(tx, dto.warehouseId, variantIds);

    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        storeId: true,
        canRent: true,
        rentPricePerDay: true,
        product: { select: { isArchived: true } },
      },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));
    for (const variantId of variantIds) {
      const variant = variantById.get(variantId);
      if (!variant || variant.storeId !== options.storeId) {
        throw new BadRequestException(
          `Product variant not found: ${variantId}`,
        );
      }
      if (
        variant.product.isArchived ||
        !variant.canRent ||
        !variant.rentPricePerDay ||
        variant.rentPricePerDay.lte(0)
      ) {
        throw new BadRequestException({
          code: RentalErrorCode.VARIANT_NOT_RENTABLE,
          message: `Product variant cannot be rented: ${variantId}`,
          variantId,
        });
      }
    }

    const availability = await this.availability.getAvailability(tx, {
      warehouseId: dto.warehouseId,
      variantIds,
      range: { from: start, to: end },
      excludeRentalId: options.excludeRentalId,
    });
    const availableById = new Map(availability.map((a) => [a.variantId, a]));
    for (const item of dto.items) {
      const available = availableById.get(item.variantId)?.available ?? 0;
      if (available < item.quantity) {
        throw new ConflictException({
          code: RentalErrorCode.NOT_AVAILABLE,
          message: `Not enough free units of variant ${item.variantId} on these dates (available: ${available}, requested: ${item.quantity})`,
          variantId: item.variantId,
          available,
        });
      }
    }

    const canLowerPrice = this.canManageStore(user);
    let total = new Decimal(0);
    const lines: BookingLine[] = dto.items.map((item) => {
      const variant = variantById.get(item.variantId)!;
      const retailPrice = variant.rentPricePerDay!.mul(days);
      const sale = new Decimal(item.sale ?? 0);
      if (sale.gt(retailPrice)) {
        throw new BadRequestException('Discount cannot exceed the item price');
      }
      if (sale.gt(0) && !canLowerPrice) {
        const kept = options.savedLines?.some(
          (s) => s.variantId === item.variantId && s.sale.eq(sale),
        );
        if (!kept) {
          throw new ForbiddenException(
            'Only an owner or a manager can lower the price',
          );
        }
      }
      total = total.add(retailPrice.sub(sale).mul(item.quantity));
      return {
        variantId: item.variantId,
        quantity: item.quantity,
        retailPrice,
        sale,
      };
    });

    const services: BookingService[] = (dto.services ?? []).map((s) => {
      const price = new Decimal(s.price);
      const sale = new Decimal(s.sale ?? 0);
      if (sale.gt(price)) {
        throw new BadRequestException(
          'Discount cannot exceed the service price',
        );
      }
      total = total.add(price.sub(sale));
      return { name: s.name, price, sale, description: s.description ?? null };
    });

    return {
      startDate: start,
      endDate: end,
      plannedDays: days,
      lines,
      services,
      totalAmount: total,
    };
  }

  private async assertCustomer(tx: Db, customerId: string) {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');
  }

  /** Locks the order row so concurrent payments/edits see the same totals. */
  private async lockOrder(tx: Db, orderId: string) {
    await tx.$queryRaw`SELECT id FROM "orders" WHERE id = ${orderId} FOR UPDATE`;
  }

  async create(dto: CreateRentalDto, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    await this.assertWarehouse(user, storeId, dto.warehouseId);
    try {
      const rental = await this.prisma.$transaction(async (tx) => {
        await this.assertCustomer(tx, dto.customerId);
        const booking = await this.prepareBooking(tx, dto, user, {
          storeId,
          allowPastStart: false,
        });
        const order = await tx.order.create({
          data: {
            storeId,
            warehouseId: dto.warehouseId,
            cashierId: user.staff.id,
            customerId: dto.customerId,
            channel: OrderChannel.POS,
            // HOLD while booked/issued: takes prepayment and extra payments (R6)
            status: OrderStatus.HOLD,
            totalAmount: booking.totalAmount,
            items: {
              create: booking.lines.map((l) => ({
                ...l,
                // Renting does not consume the item
                costAtSale: 0,
              })),
            },
            services: { create: booking.services },
          },
        });
        return tx.rental.create({
          data: {
            orderId: order.id,
            storeId,
            warehouseId: dto.warehouseId,
            customerId: dto.customerId,
            startDate: booking.startDate,
            endDate: booking.endDate,
            plannedDays: booking.plannedDays,
            notes: dto.notes ?? null,
          },
        });
      });
      this.logger.info(
        { rentalId: rental.id, orderId: rental.orderId, storeId },
        'Rental booked',
      );
      return this.findOne(rental.id, user);
    } catch (error: unknown) {
      this.fail(
        error,
        { warehouseId: dto.warehouseId, userId: user.id },
        'Failed to book rental',
      );
    }
  }

  /** R11: dates, items, quantities, discounts, services of a BOOKED rental. */
  async update(id: string, dto: UpdateRentalDto, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    await this.assertWarehouse(user, storeId, dto.warehouseId);
    try {
      await this.prisma.$transaction(async (tx) => {
        const rental = await tx.rental.findUnique({
          where: { id },
          include: { order: { include: { items: true } } },
        });
        this.assertRentalAccess(rental, storeId, user);
        if (rental.status !== RentalStatus.BOOKED) {
          throw new BadRequestException('Only a booked rental can be changed');
        }
        await this.lockOrder(tx, rental.orderId);
        const order = await tx.order.findUniqueOrThrow({
          where: { id: rental.orderId },
          select: { paidAmount: true },
        });
        await this.assertCustomer(tx, dto.customerId);

        const booking = await this.prepareBooking(tx, dto, user, {
          storeId,
          // A booking whose start already passed may still be edited if the start stays
          allowPastStart: dto.startDate === toLocalDate(rental.startDate),
          excludeRentalId: rental.id,
          savedLines: rental.order.items,
        });
        if (booking.totalAmount.lt(order.paidAmount)) {
          throw new BadRequestException(
            'The new total is less than the amount already paid; refund the difference first',
          );
        }

        // Nothing references the lines of a BOOKED rental yet: replace them
        await tx.orderItem.deleteMany({ where: { orderId: rental.orderId } });
        await tx.additionalService.deleteMany({
          where: { orderId: rental.orderId },
        });
        await tx.orderItem.createMany({
          data: booking.lines.map((l) => ({
            ...l,
            orderId: rental.orderId,
            costAtSale: 0,
          })),
        });
        if (booking.services.length > 0) {
          await tx.additionalService.createMany({
            data: booking.services.map((s) => ({
              ...s,
              orderId: rental.orderId,
            })),
          });
        }
        await tx.order.update({
          where: { id: rental.orderId },
          data: {
            totalAmount: booking.totalAmount,
            customerId: dto.customerId,
            warehouseId: dto.warehouseId,
          },
        });
        await tx.rental.update({
          where: { id: rental.id },
          data: {
            warehouseId: dto.warehouseId,
            customerId: dto.customerId,
            startDate: booking.startDate,
            endDate: booking.endDate,
            plannedDays: booking.plannedDays,
            notes: dto.notes ?? null,
          },
        });
      });
      this.logger.info({ rentalId: id }, 'Rental updated');
      return this.findOne(id, user);
    } catch (error: unknown) {
      this.fail(error, { rentalId: id }, 'Failed to update rental');
    }
  }

  // -------------------------------------------------------------- payments

  /**
   * R5: prepayment / extra payment (Payment + CashTransaction INCOME/RENTAL +
   * cashbox balance) and/or non-cash collateral (passport, gold).
   */
  async addPayments(
    id: string,
    dto: CreateRentalPaymentDto,
    user: CurrentUser,
  ) {
    const storeId = await this.assertRentalStore(user);
    const payments = (dto.payments ?? []).filter((p) => p.amount > 0);
    const collaterals = dto.collaterals ?? [];
    if (payments.length === 0 && collaterals.length === 0) {
      throw new BadRequestException(
        'Nothing to save: add a payment or a collateral',
      );
    }
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      select: { id: true, storeId: true, warehouseId: true, orderId: true },
    });
    this.assertRentalAccess(rental, storeId, user);
    try {
      // Money goes to the employee's own open cashbox or the chosen open one
      const cashbox =
        payments.length > 0
          ? await resolvePaymentCashbox(this.prisma, user, {
              cashboxId: dto.cashboxId,
              warehouseId: rental.warehouseId,
            })
          : null;
      const newPaid = payments.reduce(
        (sum, p) => sum.add(p.amount),
        new Decimal(0),
      );

      await this.prisma.$transaction(async (tx) => {
        await this.lockOrder(tx, rental.orderId);
        const current = await tx.rental.findUniqueOrThrow({
          where: { id },
          select: {
            status: true,
            order: { select: { totalAmount: true, paidAmount: true } },
          },
        });
        if (!PAYABLE_STATUSES.includes(current.status)) {
          throw new BadRequestException(
            `Cannot take a payment for a rental in ${current.status} status`,
          );
        }
        const paidAmount = current.order.paidAmount.add(newPaid);
        if (paidAmount.gt(current.order.totalAmount)) {
          throw new BadRequestException('Payment amount exceeds order total');
        }

        if (cashbox) {
          await this.takePayments(tx, {
            cashboxId: cashbox.id,
            orderId: rental.orderId,
            payments,
            user,
          });
          await tx.order.update({
            where: { id: rental.orderId },
            data: {
              paidAmount,
              // After a return the order is a debt until fully paid (R6)
              ...(current.status === RentalStatus.PARTIALLY_RETURNED
                ? {
                    status: paidAmount.gte(current.order.totalAmount)
                      ? OrderStatus.COMPLETED
                      : OrderStatus.DEBT,
                  }
                : {}),
            },
          });
        }
        if (collaterals.length > 0) {
          await tx.rentalCollateral.createMany({
            data: collaterals.map((c) => ({
              rentalId: id,
              type: c.type,
              description: c.description,
              receivedBy: user.staff.id,
            })),
          });
        }
      });
      this.logger.info(
        {
          rentalId: id,
          amount: newPaid.toString(),
          collaterals: collaterals.length,
          cashboxId: cashbox?.id,
        },
        'Rental payment saved',
      );
      return this.findOne(id, user);
    } catch (error: unknown) {
      this.fail(error, { rentalId: id }, 'Failed to save rental payment');
    }
  }

  /** Payment + CashTransaction INCOME/RENTAL + cashbox balance (R5). */
  private async takePayments(
    tx: Db,
    {
      cashboxId,
      orderId,
      payments,
      user,
    }: {
      cashboxId: string;
      orderId: string;
      payments: { type: PaymentType; amount: number }[];
      user: CurrentUser;
    },
  ) {
    if (payments.length === 0) return;
    await tx.payment.createMany({
      data: payments.map((p) => ({
        orderId,
        type: p.type,
        amount: p.amount,
        createdBy: user.staff.id,
      })),
    });
    await tx.cashTransaction.createMany({
      data: payments.map((p) => ({
        cashboxId,
        createdById: user.staff.id,
        type: CashTransactionType.INCOME,
        category: CashTransactionCategory.RENTAL,
        paymentType: p.type,
        amount: p.amount,
        orderId,
      })),
    });
    await tx.cashbox.update({
      where: { id: cashboxId },
      data: {
        balance: {
          increment: payments.reduce(
            (sum, p) => sum.add(p.amount),
            new Decimal(0),
          ),
        },
      },
    });
  }

  /** Money given back to the customer: CashTransaction EXPENSE/RETURN (R4, R9). */
  private async payOut(
    tx: Db,
    {
      cashboxId,
      orderId,
      amount,
      paymentType,
      user,
    }: {
      cashboxId: string;
      orderId: string;
      amount: Decimal;
      paymentType: PaymentType;
      user: CurrentUser;
    },
  ) {
    await tx.cashTransaction.create({
      data: {
        cashboxId,
        createdById: user.staff.id,
        type: CashTransactionType.EXPENSE,
        category: CashTransactionCategory.RETURN,
        paymentType,
        amount,
        orderId,
      },
    });
    await tx.cashbox.update({
      where: { id: cashboxId },
      data: { balance: { decrement: amount } },
    });
  }

  // -------------------------------------------------------------- lifecycle

  /**
   * Hands the items over (BOOKED → ISSUED). Only from the start date and
   * before the end of the booking; the units must be in the salon now —
   * a late previous customer or dry cleaning blocks the issue (409).
   * Sets `soldAt`: from now on the rental counts in the sales summary (R6).
   */
  async issue(id: string, dto: IssueRentalDto, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    const payments = (dto.payments ?? []).filter((p) => p.amount > 0);
    const collaterals = dto.collaterals ?? [];
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      select: { id: true, storeId: true, warehouseId: true, orderId: true },
    });
    this.assertRentalAccess(rental, storeId, user);
    try {
      const cashbox =
        payments.length > 0
          ? await resolvePaymentCashbox(this.prisma, user, {
              cashboxId: dto.cashboxId,
              warehouseId: rental.warehouseId,
            })
          : null;
      const now = new Date();

      await this.prisma.$transaction(async (tx) => {
        await this.lockOrder(tx, rental.orderId);
        const current = await tx.rental.findUniqueOrThrow({
          where: { id },
          select: {
            status: true,
            startDate: true,
            endDate: true,
            _count: {
              select: { collaterals: { where: { returnedAt: null } } },
            },
            order: {
              select: {
                totalAmount: true,
                paidAmount: true,
                items: { select: { variantId: true, quantity: true } },
              },
            },
          },
        });
        if (current.status !== RentalStatus.BOOKED) {
          throw new BadRequestException(
            `Only a booked rental can be issued (status: ${current.status})`,
          );
        }
        if (todayLocalDate(now) < toLocalDate(current.startDate)) {
          throw new BadRequestException(
            'The rental cannot be issued before its start date; change the booking dates first',
          );
        }
        if (now.getTime() >= current.endDate.getTime()) {
          throw new BadRequestException(
            'The booking period is over; change the booking dates first',
          );
        }

        // The units must be free from now on: not with a late customer, not in cleaning
        const variantIds = current.order.items.map((i) => i.variantId);
        await this.availability.lockInventory(
          tx,
          rental.warehouseId,
          variantIds,
        );
        const free = await this.availability.getAvailability(tx, {
          warehouseId: rental.warehouseId,
          variantIds,
          range: { from: now, to: current.endDate },
          excludeRentalId: id,
          now,
        });
        const freeById = new Map(free.map((f) => [f.variantId, f.available]));
        for (const item of current.order.items) {
          const available = freeById.get(item.variantId) ?? 0;
          if (available < item.quantity) {
            throw new ConflictException({
              code: RentalErrorCode.NOT_AVAILABLE,
              message: `Variant ${item.variantId} is not in the salon now (available: ${available}, needed: ${item.quantity}): register the previous return first`,
              variantId: item.variantId,
              available,
            });
          }
        }

        const newPaid = payments.reduce(
          (sum, p) => sum.add(p.amount),
          new Decimal(0),
        );
        const paidAmount = current.order.paidAmount.add(newPaid);
        if (paidAmount.gt(current.order.totalAmount)) {
          throw new BadRequestException('Payment amount exceeds order total');
        }
        if (cashbox) {
          await this.takePayments(tx, {
            cashboxId: cashbox.id,
            orderId: rental.orderId,
            payments,
            user,
          });
        }
        // Order stays HOLD until the first return (R6)
        await tx.order.update({
          where: { id: rental.orderId },
          data: { paidAmount, soldAt: now },
        });
        await tx.rental.update({
          where: { id },
          data: {
            status: RentalStatus.ISSUED,
            issuedAt: now,
            issuedBy: user.staff.id,
            issuedWithoutCollateral:
              current._count.collaterals + collaterals.length === 0,
          },
        });
        if (collaterals.length > 0) {
          await tx.rentalCollateral.createMany({
            data: collaterals.map((c) => ({
              rentalId: id,
              type: c.type,
              description: c.description,
              receivedBy: user.staff.id,
            })),
          });
        }
      });
      this.logger.info(
        { rentalId: id, payments: payments.length, cashboxId: cashbox?.id },
        'Rental issued',
      );
      return this.findOne(id, user);
    } catch (error: unknown) {
      this.fail(error, { rentalId: id }, 'Failed to issue rental');
    }
  }

  /**
   * Return moment: now by default; a moment in the past only for OWNER/MANAGER
   * (a few minutes of clock drift are tolerated); never in the future.
   */
  private resolveReturnedAt(
    value: string | undefined,
    user: CurrentUser,
    now: Date,
  ): Date {
    if (!value) return now;
    const returnedAt = new Date(value);
    if (Number.isNaN(returnedAt.getTime())) {
      throw new BadRequestException('Invalid returnedAt');
    }
    if (returnedAt.getTime() > now.getTime() + RETURN_CLOCK_TOLERANCE_MS) {
      throw new BadRequestException('returnedAt cannot be in the future');
    }
    if (
      returnedAt.getTime() < now.getTime() - RETURN_CLOCK_TOLERANCE_MS &&
      !this.canManageStore(user)
    ) {
      throw new ForbiddenException(
        'Only an owner or a manager can register a return in the past',
      );
    }
    return returnedAt;
  }

  /** Validates a return against the current rental and computes its money. */
  private settle(
    rental: ReturnRental,
    dto: RentalReturnDto,
    returnedAt: Date,
  ): ReturnSettlement {
    if (!OUT_STATUSES.includes(rental.status)) {
      throw new BadRequestException(
        `Only issued items can be returned (status: ${rental.status})`,
      );
    }
    if (rental.issuedAt && returnedAt.getTime() < rental.issuedAt.getTime()) {
      throw new BadRequestException('returnedAt cannot be before the issue');
    }
    return settleReturn({
      rental,
      items: rental.order.items.map((i) => ({
        id: i.id,
        variantId: i.variantId,
        quantity: i.quantity,
        retailPrice: i.retailPrice,
        sale: i.sale,
        returnedQuantity: i.rentalReturnItems.reduce(
          (sum, r) => sum + r.quantity,
          0,
        ),
      })),
      totalAmount: rental.order.totalAmount,
      paidAmount: rental.order.paidAmount,
      returnedAt,
      lines: dto.items,
      penaltyAmount: new Decimal(dto.penaltyAmount ?? 0),
      penaltyComment: dto.penaltyComment,
      earlyReturnRefund: new Decimal(dto.earlyReturnRefund ?? 0),
      paymentsAmount: (dto.payments ?? []).reduce(
        (sum, p) => sum.add(p.amount),
        new Decimal(0),
      ),
    });
  }

  private assertEarlyRefundRole(dto: RentalReturnDto, user: CurrentUser) {
    if ((dto.earlyReturnRefund ?? 0) > 0 && !this.canManageStore(user)) {
      throw new ForbiddenException(
        'Only an owner or a manager can lower the total on an early return',
      );
    }
  }

  /** POST /rental/:id/returns/preview: the return computed, nothing saved. */
  async previewReturn(id: string, dto: RentalReturnDto, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    this.assertEarlyRefundRole(dto, user);
    const returnedAt = this.resolveReturnedAt(dto.returnedAt, user, new Date());
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      select: { ...returnRentalSelect, storeId: true, warehouseId: true },
    });
    this.assertRentalAccess(rental, storeId, user);
    const result = this.settle(rental, dto, returnedAt);
    return { returnedAt, ...result };
  }

  /**
   * POST /rental/:id/returns: full or partial return (R4, R6–R8, R10).
   * Units become free at `returnedAt + cleaningDays`; the order total gets the
   * penalty and loses the early-return refund; overpaid money goes back from
   * the cashbox; the order becomes COMPLETED or DEBT.
   */
  async createReturn(id: string, dto: RentalReturnDto, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    this.assertEarlyRefundRole(dto, user);
    const now = new Date();
    const returnedAt = this.resolveReturnedAt(dto.returnedAt, user, now);
    const payments = (dto.payments ?? []).filter((p) => p.amount > 0);
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      select: { id: true, storeId: true, warehouseId: true, orderId: true },
    });
    this.assertRentalAccess(rental, storeId, user);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lockOrder(tx, rental.orderId);
        const current = await tx.rental.findUniqueOrThrow({
          where: { id },
          select: returnRentalSelect,
        });
        let cashbox: Cashbox | null = null;
        const settlement = this.settle(
          current,
          { ...dto, payments },
          returnedAt,
        );
        if (settlement.cashOutAmount.gt(0) && !dto.refundPaymentType) {
          throw new BadRequestException(
            `refundPaymentType is required: ${settlement.cashOutAmount.toString()} must be given back to the customer`,
          );
        }
        if (payments.length > 0 || settlement.cashOutAmount.gt(0)) {
          cashbox = await resolvePaymentCashbox(tx, user, {
            cashboxId: dto.cashboxId,
            warehouseId: rental.warehouseId,
          });
        }

        const created = await tx.rentalReturn.create({
          data: {
            rentalId: id,
            returnedAt,
            penaltyAmount: settlement.penaltyAmount,
            penaltyComment: dto.penaltyComment?.trim() || null,
            earlyReturnRefund: settlement.earlyReturnRefund,
            createdBy: user.staff.id,
            items: {
              create: settlement.items.map((i) => ({
                orderItemId: i.orderItemId,
                quantity: i.quantity,
                cleaningDays: i.cleaningDays,
                availableFrom: i.availableFrom,
              })),
            },
          },
        });
        if (cashbox) {
          await this.takePayments(tx, {
            cashboxId: cashbox.id,
            orderId: rental.orderId,
            payments,
            user,
          });
          if (settlement.cashOutAmount.gt(0) && dto.refundPaymentType) {
            await this.payOut(tx, {
              cashboxId: cashbox.id,
              orderId: rental.orderId,
              amount: settlement.cashOutAmount,
              paymentType: dto.refundPaymentType,
              user,
            });
          }
        }
        await tx.order.update({
          where: { id: rental.orderId },
          data: {
            totalAmount: settlement.newTotalAmount,
            paidAmount: settlement.paidAmountAfter,
            status: settlement.orderStatusAfter,
          },
        });
        await tx.rental.update({
          where: { id },
          data: {
            status: settlement.rentalStatusAfter,
            ...(settlement.rentalStatusAfter === RentalStatus.RETURNED
              ? { closedAt: now }
              : {}),
          },
        });
        return { returnId: created.id, settlement };
      });
      this.logger.info(
        {
          rentalId: id,
          returnId: result.returnId,
          status: result.settlement.rentalStatusAfter,
          penalty: result.settlement.penaltyAmount.toString(),
          cashOut: result.settlement.cashOutAmount.toString(),
        },
        'Rental return registered',
      );
      return this.findOne(id, user);
    } catch (error: unknown) {
      this.fail(error, { rentalId: id }, 'Failed to register rental return');
    }
  }

  /**
   * GET /rental/:id/cleaning-conflicts (R7): bookings of the same variants
   * that would lack a unit while the returned items are in dry cleaning.
   * A warning only — the seller decides.
   */
  async getCleaningConflicts(
    id: string,
    query: CleaningConflictsQuery,
    user: CurrentUser,
  ) {
    const storeId = await this.assertRentalStore(user);
    const now = new Date();
    const returnedAt = query.returnedAt ? new Date(query.returnedAt) : now;
    if (Number.isNaN(returnedAt.getTime())) {
      throw new BadRequestException('Invalid returnedAt');
    }
    const lines = parseConflictItems(query.items);
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      select: {
        id: true,
        storeId: true,
        warehouseId: true,
        status: true,
        startDate: true,
        endDate: true,
        order: {
          select: {
            items: {
              select: {
                id: true,
                variantId: true,
                quantity: true,
                rentalReturnItems: {
                  select: { quantity: true, availableFrom: true },
                },
              },
            },
          },
        },
      },
    });
    this.assertRentalAccess(rental, storeId, user);
    if (!OUT_STATUSES.includes(rental.status)) {
      throw new BadRequestException(
        `Only issued items can be returned (status: ${rental.status})`,
      );
    }
    const itemById = new Map(rental.order.items.map((i) => [i.id, i]));

    try {
      const result: CleaningConflict[] = [];
      for (const line of lines) {
        const item = itemById.get(line.orderItemId);
        if (!item) {
          throw new BadRequestException(
            `Order item does not belong to this rental: ${line.orderItemId}`,
          );
        }
        const availableFrom = addDaysToInstant(returnedAt, line.cleaningDays);
        const conflicts: CleaningConflict['conflicts'] = [];
        if (line.cleaningDays > 0) {
          conflicts.push(
            ...(await this.findCleaningConflicts({
              warehouseId: rental.warehouseId,
              rental,
              item,
              quantity: line.quantity,
              window: { from: returnedAt, to: availableFrom },
              now,
            })),
          );
        }
        result.push({
          orderItemId: item.id,
          variantId: item.variantId,
          availableFrom,
          conflicts,
        });
      }
      return result;
    } catch (error: unknown) {
      this.fail(error, { rentalId: id }, 'Failed to check cleaning conflicts');
    }
  }

  private async findCleaningConflicts({
    warehouseId,
    rental,
    item,
    quantity,
    window,
    now,
  }: {
    warehouseId: string;
    rental: { id: string; startDate: Date; endDate: Date };
    item: {
      variantId: string;
      quantity: number;
      rentalReturnItems: { quantity: number; availableFrom: Date }[];
    };
    quantity: number;
    window: { from: Date; to: Date };
    now: Date;
  }): Promise<CleaningConflict['conflicts']> {
    const others = await this.availability.findOccupancy(this.prisma, {
      warehouseId,
      variantIds: [item.variantId],
      range: window,
      excludeRentalId: rental.id,
      now,
    });
    // This rental after the return: earlier returns, the units returned now
    // (busy until the end of cleaning), the units still with the customer
    const returnedBefore = item.rentalReturnItems.reduce(
      (sum, r) => sum + r.quantity,
      0,
    );
    const outstanding = Math.max(0, item.quantity - returnedBefore - quantity);
    const own: Occupancy[] = [
      ...item.rentalReturnItems.map((r) => ({
        variantId: item.variantId,
        rentalId: rental.id,
        from: rental.startDate,
        to: r.availableFrom,
        quantity: r.quantity,
      })),
      {
        variantId: item.variantId,
        rentalId: rental.id,
        from: rental.startDate,
        to: window.to,
        quantity,
      },
      {
        variantId: item.variantId,
        rentalId: rental.id,
        from: rental.startDate,
        to: new Date(Math.max(rental.endDate.getTime(), now.getTime())),
        quantity: outstanding,
      },
    ];

    const candidateIds = [...new Set(others.map((o) => o.rentalId))];
    if (candidateIds.length === 0) return [];
    const [inventory, candidates] = await Promise.all([
      this.prisma.inventory.findFirst({
        where: { warehouseId, variantId: item.variantId },
        select: { quantity: true },
      }),
      // Only bookings not handed over yet can be affected
      this.prisma.rental.findMany({
        where: {
          id: { in: candidateIds },
          status: RentalStatus.BOOKED,
          startDate: { lt: window.to },
        },
        select: {
          id: true,
          orderId: true,
          startDate: true,
          endDate: true,
          order: {
            select: {
              customer: { select: { user: { select: { fullName: true } } } },
            },
          },
        },
        orderBy: { startDate: 'asc' },
      }),
    ]);
    const owned = inventory?.quantity ?? 0;

    const conflicts: CleaningConflict['conflicts'] = [];
    for (const candidate of candidates) {
      const overlap = {
        from: new Date(
          Math.max(candidate.startDate.getTime(), window.from.getTime()),
        ),
        to: new Date(
          Math.min(candidate.endDate.getTime(), window.to.getTime()),
        ),
      };
      if (overlap.from.getTime() >= overlap.to.getTime()) continue;
      const needed = others
        .filter((o) => o.rentalId === candidate.id)
        .reduce((sum, o) => sum + o.quantity, 0);
      const busy = peakOccupancy(
        [...others.filter((o) => o.rentalId !== candidate.id), ...own],
        overlap,
      );
      const availableAtStart = Math.max(0, owned - busy);
      if (availableAtStart < needed) {
        conflicts.push({
          rentalId: candidate.id,
          orderId: candidate.orderId,
          customerName: candidate.order.customer?.user.fullName ?? null,
          startDate: toLocalDate(candidate.startDate),
          endDate: toLocalDate(candidate.endDate),
          quantity: needed,
          availableAtStart,
        });
      }
    }
    return conflicts;
  }

  /**
   * POST /rental/:id/collaterals/:collateralId/return (R5): passport, gold
   * etc. go back once the order is fully paid (or the booking is cancelled).
   * Items still with the customer do not block it — the client warns.
   */
  async returnCollateral(id: string, collateralId: string, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      select: { id: true, storeId: true, warehouseId: true, orderId: true },
    });
    this.assertRentalAccess(rental, storeId, user);
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockOrder(tx, rental.orderId);
        const current = await tx.rental.findUniqueOrThrow({
          where: { id },
          select: {
            status: true,
            order: { select: { totalAmount: true, paidAmount: true } },
          },
        });
        const collateral = await tx.rentalCollateral.findFirst({
          where: { id: collateralId, rentalId: id },
        });
        if (!collateral) throw new NotFoundException('Collateral not found');
        if (collateral.returnedAt) {
          throw new BadRequestException('The collateral is already returned');
        }
        if (
          current.status !== RentalStatus.CANCELLED &&
          current.order.paidAmount.lt(current.order.totalAmount)
        ) {
          throw new BadRequestException(
            'The collateral can be returned only after full payment',
          );
        }
        await tx.rentalCollateral.update({
          where: { id: collateralId },
          data: { returnedAt: new Date(), returnedBy: user.staff.id },
        });
      });
      this.logger.info({ rentalId: id, collateralId }, 'Collateral returned');
      return this.findOne(id, user);
    } catch (error: unknown) {
      this.fail(
        error,
        { rentalId: id, collateralId },
        'Failed to return collateral',
      );
    }
  }

  /**
   * POST /rental/:id/cancel (R9): OWNER/MANAGER, BOOKED only. `refundAmount`
   * of the prepayment goes back from the cashbox (EXPENSE/RETURN); the rest
   * stays income. The order keeps the net paid amount; units are freed.
   */
  async cancel(id: string, dto: CancelRentalDto, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    if (!this.canManageStore(user)) {
      throw new ForbiddenException(
        'Only an owner or a manager can cancel a booking',
      );
    }
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      select: { id: true, storeId: true, warehouseId: true, orderId: true },
    });
    this.assertRentalAccess(rental, storeId, user);
    const refund = new Decimal(dto.refundAmount ?? 0);
    if (refund.gt(0) && !dto.refundPaymentType) {
      throw new BadRequestException(
        'refundPaymentType is required to give money back',
      );
    }
    try {
      const cashbox = refund.gt(0)
        ? await resolvePaymentCashbox(this.prisma, user, {
            cashboxId: dto.cashboxId,
            warehouseId: rental.warehouseId,
          })
        : null;
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await this.lockOrder(tx, rental.orderId);
        const current = await tx.rental.findUniqueOrThrow({
          where: { id },
          select: { status: true, order: { select: { paidAmount: true } } },
        });
        if (current.status !== RentalStatus.BOOKED) {
          throw new BadRequestException(
            `Only a booked rental can be cancelled (status: ${current.status}); issued items are returned instead`,
          );
        }
        if (refund.gt(current.order.paidAmount)) {
          throw new BadRequestException(
            `refundAmount cannot exceed the amount paid (${current.order.paidAmount.toString()})`,
          );
        }
        if (cashbox && dto.refundPaymentType) {
          await this.payOut(tx, {
            cashboxId: cashbox.id,
            orderId: rental.orderId,
            amount: refund,
            paymentType: dto.refundPaymentType,
            user,
          });
        }
        await tx.order.update({
          where: { id: rental.orderId },
          data: {
            status: OrderStatus.CANCELLED,
            paidAmount: current.order.paidAmount.sub(refund),
          },
        });
        await tx.rental.update({
          where: { id },
          data: {
            status: RentalStatus.CANCELLED,
            cancelledAt: now,
            cancelledBy: user.staff.id,
            refundAmount: refund,
            cancelReason: dto.reason?.trim() || null,
          },
        });
      });
      this.logger.info(
        { rentalId: id, refund: refund.toString(), cashboxId: cashbox?.id },
        'Rental cancelled',
      );
      return this.findOne(id, user);
    } catch (error: unknown) {
      this.fail(error, { rentalId: id }, 'Failed to cancel rental');
    }
  }

  // ----------------------------------------------------------------- reads

  async findOne(id: string, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      include: rentalDetailsInclude,
    });
    this.assertRentalAccess(rental, storeId, user);
    const { order, ...rest } = rental;
    const returnedByItem = new Map<string, number>();
    for (const r of rental.returns) {
      for (const i of r.items) {
        returnedByItem.set(
          i.orderItemId,
          (returnedByItem.get(i.orderItemId) ?? 0) + i.quantity,
        );
      }
    }
    return {
      ...rest,
      code: rentalCode(rental.id),
      overdue:
        OUT_STATUSES.includes(rental.status) &&
        rental.endDate.getTime() < Date.now(),
      order: {
        ...order,
        // A cancelled booking owes nothing: the kept prepayment is the income
        dueAmount:
          rental.status === RentalStatus.CANCELLED
            ? new Decimal(0)
            : order.totalAmount.sub(order.paidAmount),
        items: order.items.map((item) => ({
          ...item,
          returnedQuantity: returnedByItem.get(item.id) ?? 0,
        })),
      },
    };
  }

  /** Rentals the user may see: the store; non-owners only their warehouses */
  private scopeWhere(
    user: CurrentUser,
    storeId: string,
  ): Prisma.RentalWhereInput {
    return this.isStoreOwner(user)
      ? { storeId }
      : {
          storeId,
          warehouseId: { in: user.staff.warehouse.map((w) => w.warehouseId) },
        };
  }

  /** Filter of a quick list view (RENTAL_VIEWS) at `now` */
  private viewWhere(view: RentalView, now: Date): Prisma.RentalWhereInput {
    const today = todayLocalDate(now);
    const todayNoon = rentalBoundary(today);
    const tomorrowNoon = rentalBoundary(addLocalDays(today, 1));
    switch (view) {
      case 'issueToday':
        // Can be issued now: started by today and not over yet (R5a)
        return {
          status: RentalStatus.BOOKED,
          startDate: { lt: tomorrowNoon },
          endDate: { gt: now },
        };
      case 'returnToday':
        return {
          status: { in: OUT_STATUSES },
          endDate: { gte: todayNoon, lt: tomorrowNoon },
        };
      case 'overdue':
        return { status: { in: OUT_STATUSES }, endDate: { lt: now } };
      case 'booked':
        return { status: RentalStatus.BOOKED };
      case 'out':
        return { status: { in: OUT_STATUSES } };
      case 'all':
        return {};
    }
  }

  /** Search by the short code, customer name or phone digits */
  private searchWhere(q: string): Prisma.RentalWhereInput | null {
    const text = q.trim();
    if (!text) return null;
    const or: Prisma.RentalWhereInput[] = [
      {
        order: {
          customer: {
            user: { fullName: { contains: text, mode: 'insensitive' } },
          },
        },
      },
    ];
    if (RENTAL_CODE_SEARCH.test(text)) {
      or.push({ id: { startsWith: text.toLowerCase() } });
    }
    const digits = text.replace(/\D/g, '');
    if (digits.length >= MIN_PHONE_SEARCH_DIGITS) {
      or.push({
        order: { customer: { user: { phone: { contains: digits } } } },
      });
    }
    return { OR: or };
  }

  /** Filter of GET /rental */
  private listWhere(
    query: RentalListQuery,
    user: CurrentUser,
    storeId: string,
    now: Date,
  ): Prisma.RentalWhereInput {
    const and: Prisma.RentalWhereInput[] = [this.scopeWhere(user, storeId)];
    if (query.status) {
      const statuses = query.status.split(',');
      const valid = Object.values(RentalStatus) as string[];
      const invalid = statuses.find((s) => !valid.includes(s));
      if (invalid) {
        throw new BadRequestException(`Unknown rental status: ${invalid}`);
      }
      and.push({ status: { in: statuses as RentalStatus[] } });
    }
    try {
      if (query.from)
        and.push({ endDate: { gte: rentalBoundary(query.from) } });
      if (query.to) and.push({ startDate: { lte: rentalBoundary(query.to) } });
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid date',
      );
    }
    if (query.customerId) and.push({ customerId: query.customerId });
    if (query.overdue === 'true') and.push(this.viewWhere('overdue', now));
    if (query.view) and.push(this.viewWhere(query.view, now));
    if (query.variantId) {
      and.push({
        order: { items: { some: { variantId: query.variantId } } },
      });
    }
    const search = query.q ? this.searchWhere(query.q) : null;
    if (search) and.push(search);
    return { AND: and };
  }

  /** GET /rental/summary: counters of the quick list views */
  async getSummary(user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    const scope = this.scopeWhere(user, storeId);
    const now = new Date();
    try {
      const counts = await Promise.all(
        RENTAL_VIEWS.map((view) =>
          this.prisma.rental.count({
            where: { AND: [scope, this.viewWhere(view, now)] },
          }),
        ),
      );
      return Object.fromEntries(
        RENTAL_VIEWS.map((view, i) => [view, counts[i]]),
      ) as Record<RentalView, number>;
    } catch (error: unknown) {
      this.fail(error, { storeId }, 'Failed to count rentals');
    }
  }

  async findAll(query: RentalListQuery, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    const pageSize = Math.min(
      Math.max(Number(query.pageSize) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const currentPage = Math.max(Number(query.currentPage) || 1, 1);

    const where = this.listWhere(query, user, storeId, new Date());

    try {
      const [total, rentals] = await Promise.all([
        this.prisma.rental.count({ where }),
        this.prisma.rental.findMany({
          where,
          skip: (currentPage - 1) * pageSize,
          take: pageSize,
          orderBy: [{ startDate: query.sort ?? 'desc' }, { createdAt: 'asc' }],
          include: {
            order: {
              select: {
                id: true,
                status: true,
                totalAmount: true,
                paidAmount: true,
                customer: {
                  select: {
                    id: true,
                    user: { select: { fullName: true, phone: true } },
                  },
                },
                items: {
                  orderBy: { createdAt: 'asc' },
                  select: {
                    quantity: true,
                    variant: {
                      select: {
                        id: true,
                        product: {
                          select: {
                            name: true,
                            images: {
                              orderBy: [{ isMain: 'desc' }, { order: 'asc' }],
                              take: 1,
                              select: { url: true },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);
      const now = Date.now();
      return {
        currentPage,
        pageSize,
        total,
        data: rentals.map(({ order, ...rental }) => ({
          ...rental,
          code: rentalCode(rental.id),
          overdue:
            OUT_STATUSES.includes(rental.status) &&
            rental.endDate.getTime() < now,
          order: {
            id: order.id,
            status: order.status,
            totalAmount: order.totalAmount,
            paidAmount: order.paidAmount,
            dueAmount:
              rental.status === RentalStatus.CANCELLED
                ? new Decimal(0)
                : order.totalAmount.sub(order.paidAmount),
          },
          customer: order.customer
            ? {
                id: order.customer.id,
                fullName: order.customer.user.fullName,
                phone: order.customer.user.phone,
              }
            : null,
          itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
          /** Lines for thumbnails, in booking order */
          items: order.items.map((i) => ({
            variantId: i.variant.id,
            productName: i.variant.product.name,
            imageUrl: i.variant.product.images[0]?.url ?? null,
            quantity: i.quantity,
          })),
        })),
      };
    } catch (error: unknown) {
      this.fail(error, { storeId }, 'Failed to list rentals');
    }
  }

  /** GET /rental/availability: owned and free units on the dates (R1). */
  /**
   * GET /rental/similar: replacements for a variant busy on the dates — other
   * variants of the same product, then rentable variants of its category, with
   * free units for [startDate, endDate). Busy ones are listed too (available 0).
   */
  async findSimilar(query: RentalSimilarQuery, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    await this.assertWarehouse(user, storeId, query.warehouseId);
    const { start, end } = this.resolveDates(query.startDate, query.endDate, {
      allowPastStart: true,
    });
    const base = await this.prisma.productVariant.findFirst({
      where: { id: query.variantId, storeId },
      select: { productId: true, product: { select: { categoryId: true } } },
    });
    if (!base) throw new NotFoundException('Product variant not found');

    const candidateWhere: Prisma.ProductVariantWhereInput = {
      storeId,
      canRent: true,
      id: { not: query.variantId },
      product: { isArchived: false },
      inventory: { some: { warehouseId: query.warehouseId } },
    };
    const select = {
      id: true,
      sku: true,
      rentPricePerDay: true,
      product: {
        select: {
          id: true,
          name: true,
          images: {
            orderBy: [{ isMain: 'desc' }, { order: 'asc' }],
            take: 1,
            select: { url: true },
          },
        },
      },
      attributes: {
        include: {
          value: { include: { attribute: { select: { name: true } } } },
        },
      },
    } satisfies Prisma.ProductVariantSelect;

    try {
      const [sameProduct, sameCategory] = await Promise.all([
        this.prisma.productVariant.findMany({
          where: { ...candidateWhere, productId: base.productId },
          orderBy: { createdAt: 'asc' },
          take: MAX_SIMILAR_VARIANTS,
          select,
        }),
        base.product.categoryId
          ? this.prisma.productVariant.findMany({
              where: {
                ...candidateWhere,
                productId: { not: base.productId },
                product: {
                  isArchived: false,
                  categoryId: base.product.categoryId,
                },
              },
              orderBy: { createdAt: 'asc' },
              take: MAX_SIMILAR_VARIANTS,
              select,
            })
          : Promise.resolve([]),
      ]);
      const ids = [...sameProduct, ...sameCategory].map((v) => v.id);
      const free =
        ids.length > 0
          ? await this.availability.getAvailability(this.prisma, {
              warehouseId: query.warehouseId,
              variantIds: ids,
              range: { from: start, to: end },
              excludeRentalId: query.excludeRentalId,
            })
          : [];
      const freeById = new Map(free.map((f) => [f.variantId, f]));
      const toRow = (v: (typeof sameProduct)[number]) => ({
        variantId: v.id,
        sku: v.sku,
        productId: v.product.id,
        productName: v.product.name,
        imageUrl: v.product.images[0]?.url ?? null,
        rentPricePerDay: v.rentPricePerDay,
        attributes: v.attributes.map((a) => ({
          name: a.value.attribute.name,
          value:
            a.value.valueString ??
            a.value.valueNumber?.toString() ??
            (a.value.valueBool === null ? '' : String(a.value.valueBool)),
        })),
        owned: freeById.get(v.id)?.owned ?? 0,
        available: freeById.get(v.id)?.available ?? 0,
      });
      // Free ones first, the order is kept otherwise
      const rank = (rows: ReturnType<typeof toRow>[]) =>
        [...rows].sort(
          (a, b) => Number(b.available > 0) - Number(a.available > 0),
        );
      return {
        sameProduct: rank(sameProduct.map(toRow)),
        sameCategory: rank(sameCategory.map(toRow)),
      };
    } catch (error: unknown) {
      this.fail(
        error,
        { variantId: query.variantId },
        'Failed to find similar variants',
      );
    }
  }

  async getAvailability(query: RentalAvailabilityQuery, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    await this.assertWarehouse(user, storeId, query.warehouseId);
    const { start, end } = this.resolveDates(query.startDate, query.endDate, {
      allowPastStart: true,
    });
    const variantIds = [...new Set(query.variantIds.split(','))];
    try {
      return await this.availability.getAvailability(this.prisma, {
        warehouseId: query.warehouseId,
        variantIds,
        range: { from: start, to: end },
        excludeRentalId: query.excludeRentalId,
      });
    } catch (error: unknown) {
      this.fail(
        error,
        { warehouseId: query.warehouseId },
        'Failed to get availability',
      );
    }
  }

  /**
   * GET /rental/calendar: busy units per variant per day. A calendar day `d`
   * is the window [d 12:00, d+1 12:00): a booking 14 → 16 fills the 14th and
   * the 15th, the 16th is free for the next customer.
   */
  async getCalendar(query: RentalCalendarQuery, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    await this.assertWarehouse(user, storeId, query.warehouseId);
    if (query.from > query.to) {
      throw new BadRequestException('from must not be after to');
    }
    const days: string[] = [];
    for (let d = query.from; d <= query.to; d = addLocalDays(d, 1)) {
      days.push(d);
      if (days.length > MAX_CALENDAR_DAYS) {
        throw new BadRequestException(
          `The calendar range is limited to ${MAX_CALENDAR_DAYS} days`,
        );
      }
    }
    let range: { from: Date; to: Date };
    try {
      range = {
        from: rentalBoundary(query.from),
        to: rentalBoundary(addLocalDays(query.to, 1)),
      };
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid date',
      );
    }

    try {
      const variants = await this.prisma.productVariant.findMany({
        where: {
          storeId,
          inventory: { some: { warehouseId: query.warehouseId } },
          ...(query.variantIds
            ? { id: { in: query.variantIds.split(',') } }
            : { canRent: true, product: { isArchived: false } }),
        },
        select: {
          id: true,
          sku: true,
          product: { select: { id: true, name: true } },
          inventory: {
            where: { warehouseId: query.warehouseId },
            select: { quantity: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      const occupancy = await this.availability.findOccupancy(this.prisma, {
        warehouseId: query.warehouseId,
        variantIds: variants.map((v) => v.id),
        range,
      });
      const rentals = await this.prisma.rental.findMany({
        where: { id: { in: [...new Set(occupancy.map((o) => o.rentalId))] } },
        select: {
          id: true,
          orderId: true,
          status: true,
          startDate: true,
          endDate: true,
          order: {
            select: {
              customer: { select: { user: { select: { fullName: true } } } },
            },
          },
        },
      });

      return {
        from: query.from,
        to: query.to,
        variants: variants.map((v) => {
          const owned = v.inventory.reduce((sum, i) => sum + i.quantity, 0);
          const own = occupancy.filter((o) => o.variantId === v.id);
          return {
            variantId: v.id,
            sku: v.sku,
            productId: v.product.id,
            productName: v.product.name,
            owned,
            days: days.map((date) => {
              const busy = peakOccupancy(own, {
                from: rentalBoundary(date),
                to: rentalBoundary(addLocalDays(date, 1)),
              });
              return { date, busy, available: Math.max(0, owned - busy) };
            }),
            bookings: own.map((o) => ({
              rentalId: o.rentalId,
              from: o.from,
              to: o.to,
              quantity: o.quantity,
            })),
          };
        }),
        rentals: rentals.map((r) => ({
          id: r.id,
          orderId: r.orderId,
          status: r.status,
          startDate: r.startDate,
          endDate: r.endDate,
          customerName: r.order.customer?.user.fullName ?? null,
        })),
      };
    } catch (error: unknown) {
      this.fail(
        error,
        { warehouseId: query.warehouseId },
        'Failed to build rental calendar',
      );
    }
  }
}
