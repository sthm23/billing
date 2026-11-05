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
import { Prisma } from '@generated/client';
import {
  CashTransactionCategory,
  CashTransactionType,
  OrderChannel,
  OrderStatus,
  RentalStatus,
  StaffRole,
  UserRole,
} from '@generated/enums';
import { resolvePaymentCashbox } from '../cashbox/payment-cashbox';
import { CreateRentalDto, UpdateRentalDto } from './dto/create-rental.dto';
import { CreateRentalPaymentDto } from './dto/rental-payment.dto';
import {
  RentalAvailabilityQuery,
  RentalCalendarQuery,
  RentalListQuery,
} from './dto/rental-query.dto';
import {
  peakOccupancy,
  RentalAvailabilityService,
} from './rental-availability.service';
import {
  addLocalDays,
  plannedDays,
  rentalBoundary,
  todayLocalDate,
  toLocalDate,
} from './rental-days';

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
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

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
          await tx.payment.createMany({
            data: payments.map((p) => ({
              orderId: rental.orderId,
              type: p.type,
              amount: p.amount,
              createdBy: user.staff.id,
            })),
          });
          await tx.cashTransaction.createMany({
            data: payments.map((p) => ({
              cashboxId: cashbox.id,
              createdById: user.staff.id,
              type: CashTransactionType.INCOME,
              category: CashTransactionCategory.RENTAL,
              paymentType: p.type,
              amount: p.amount,
              orderId: rental.orderId,
            })),
          });
          await tx.cashbox.update({
            where: { id: cashbox.id },
            data: { balance: { increment: newPaid } },
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
      overdue:
        OUT_STATUSES.includes(rental.status) &&
        rental.endDate.getTime() < Date.now(),
      order: {
        ...order,
        dueAmount: order.totalAmount.sub(order.paidAmount),
        items: order.items.map((item) => ({
          ...item,
          returnedQuantity: returnedByItem.get(item.id) ?? 0,
        })),
      },
    };
  }

  async findAll(query: RentalListQuery, user: CurrentUser) {
    const storeId = await this.assertRentalStore(user);
    const pageSize = Math.min(
      Math.max(Number(query.pageSize) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const currentPage = Math.max(Number(query.currentPage) || 1, 1);

    const where: Prisma.RentalWhereInput = { storeId };
    if (!this.isStoreOwner(user)) {
      where.warehouseId = {
        in: user.staff.warehouse.map((w) => w.warehouseId),
      };
    }
    const and: Prisma.RentalWhereInput[] = [];
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
    if (query.overdue === 'true') {
      and.push({
        status: { in: OUT_STATUSES },
        endDate: { lt: new Date() },
      });
    }
    if (and.length > 0) where.AND = and;

    try {
      const [total, rentals] = await Promise.all([
        this.prisma.rental.count({ where }),
        this.prisma.rental.findMany({
          where,
          skip: (currentPage - 1) * pageSize,
          take: pageSize,
          orderBy: { startDate: 'desc' },
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
                items: { select: { quantity: true } },
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
          overdue:
            OUT_STATUSES.includes(rental.status) &&
            rental.endDate.getTime() < now,
          order: {
            id: order.id,
            status: order.status,
            totalAmount: order.totalAmount,
            paidAmount: order.paidAmount,
            dueAmount: order.totalAmount.sub(order.paidAmount),
          },
          customer: order.customer
            ? {
                id: order.customer.id,
                fullName: order.customer.user.fullName,
                phone: order.customer.user.phone,
              }
            : null,
          itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
        })),
      };
    } catch (error: unknown) {
      this.fail(error, { storeId }, 'Failed to list rentals');
    }
  }

  /** GET /rental/availability: owned and free units on the dates (R1). */
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
