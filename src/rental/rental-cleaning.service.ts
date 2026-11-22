import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '@prisma/prisma.service';
import { CurrentUser } from '@auth/models/auth.model';
import { Prisma } from '@generated/client';
import {
  CashStatus,
  CashTransactionCategory,
  CashTransactionType,
  RentalCleaningStatus,
} from '@generated/enums';
import { resolvePaymentCashbox } from '../cashbox/payment-cashbox';
import {
  CancelRentalCleaningDto,
  CreateRentalCleaningDto,
  RentalCleaningCheckQuery,
  RentalCleaningListQuery,
} from './dto/rental-cleaning.dto';
import { MAX_CLEANING_DAYS } from './dto/rental-lifecycle.dto';
import {
  Occupancy,
  peakOccupancy,
  RentalAvailabilityService,
} from './rental-availability.service';
import {
  addLocalDays,
  rentalBoundary,
  todayLocalDate,
  toLocalDate,
} from './rental-days';
import { RentalErrorCode, RentalService, rentalCode } from './rental.service';

type Db = Prisma.TransactionClient;

const MAX_LIST_ROWS = 200;

/** Where a cleaning is now, for the UI (stored status is ACTIVE or CANCELLED) */
export const RentalCleaningState = {
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;
export type RentalCleaningState =
  (typeof RentalCleaningState)[keyof typeof RentalCleaningState];

/** A day of the cleaning on which the unit is missing, and who holds the units */
export interface CleaningCheckConflict {
  date: string;
  rentals: {
    rentalId: string;
    code: string;
    orderId: string;
    customerName: string | null;
    startDate: Date;
    endDate: Date;
    quantity: number;
  }[];
  cleanings: { cleaningId: string; startDate: Date; endDate: Date }[];
}

export interface CleaningCheckResult {
  ok: boolean;
  /** Units of the variant on the warehouse */
  owned: number;
  /** Free units on the whole cleaning period before this cleaning */
  available: number;
  startDate: Date;
  endDate: Date;
  conflicts: CleaningCheckConflict[];
}

const CLEANING_SELECT = {
  id: true,
  warehouseId: true,
  variantId: true,
  startDate: true,
  endDate: true,
  days: true,
  amount: true,
  paymentType: true,
  comment: true,
  status: true,
  createdBy: true,
  createdAt: true,
  cancelledBy: true,
  cancelledAt: true,
  variant: {
    select: { sku: true, product: { select: { id: true, name: true } } },
  },
} satisfies Prisma.RentalCleaningSelect;

type CleaningRow = Prisma.RentalCleaningGetPayload<{
  select: typeof CLEANING_SELECT;
}>;

/**
 * Dry cleaning planned by an OWNER/MANAGER outside a return (R13). One unit
 * of the variant is busy on `[first day 12:00, day after the last 12:00)` —
 * the same day boundary as bookings (R1). The expense goes to the cashbox at
 * once (EXPENSE/DRY_CLEANING); a cancel before the start writes it back
 * (INCOME/DRY_CLEANING). Inventory is never changed.
 */
@Injectable()
export class RentalCleaningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: RentalAvailabilityService,
    private readonly rentals: RentalService,
    @InjectPinoLogger(RentalCleaningService.name)
    private readonly logger: PinoLogger,
  ) {}

  private assertManager(user: CurrentUser) {
    if (!this.rentals.canManageStore(user)) {
      throw new ForbiddenException(
        'Only an owner or a manager can plan dry cleaning',
      );
    }
  }

  /** Cleaning period: noon of the first day to noon after the last day. */
  private resolvePeriod(startDate: string, days: number) {
    if (!Number.isInteger(days) || days < 1 || days > MAX_CLEANING_DAYS) {
      throw new BadRequestException(
        `days must be from 1 to ${MAX_CLEANING_DAYS}`,
      );
    }
    if (startDate < todayLocalDate()) {
      throw new BadRequestException('startDate cannot be in the past');
    }
    try {
      return {
        start: rentalBoundary(startDate),
        end: rentalBoundary(addLocalDays(startDate, days)),
      };
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid date',
      );
    }
  }

  /** The variant is a rental item of the store. */
  private async assertVariant(db: Db, storeId: string, variantId: string) {
    const variant = await db.productVariant.findFirst({
      where: { id: variantId, storeId },
      select: { canRent: true },
    });
    if (!variant) throw new NotFoundException('Variant not found');
    if (!variant.canRent) {
      throw new BadRequestException({
        code: RentalErrorCode.VARIANT_NOT_RENTABLE,
        message: 'The variant is not rented out',
      });
    }
  }

  /**
   * Whether one more unit fits on `[start, end)`: the peak of busy units with
   * this cleaning must not exceed the owned units, so every booking keeps its
   * unit. On a conflict, lists per day the bookings and cleanings holding units.
   */
  private async evaluate(
    db: Db,
    params: {
      warehouseId: string;
      variantId: string;
      startDate: string;
      days: number;
      start: Date;
      end: Date;
    },
  ): Promise<CleaningCheckResult> {
    const range = { from: params.start, to: params.end };
    const [inventory, occupancy] = await Promise.all([
      db.inventory.findFirst({
        where: { warehouseId: params.warehouseId, variantId: params.variantId },
        select: { quantity: true },
      }),
      this.availability.findOccupancy(db, {
        warehouseId: params.warehouseId,
        variantIds: [params.variantId],
        range,
      }),
    ]);
    const owned = inventory?.quantity ?? 0;
    const self: Occupancy = {
      variantId: params.variantId,
      rentalId: null,
      cleaningId: null,
      from: params.start,
      to: params.end,
      quantity: 1,
    };
    const result: CleaningCheckResult = {
      ok: peakOccupancy([...occupancy, self], range) <= owned,
      owned,
      available: Math.max(0, owned - peakOccupancy(occupancy, range)),
      startDate: params.start,
      endDate: params.end,
      conflicts: [],
    };
    if (result.ok) return result;

    const holders: { date: string; held: Occupancy[] }[] = [];
    for (let i = 0; i < params.days; i++) {
      const date = addLocalDays(params.startDate, i);
      const day = {
        from: rentalBoundary(date),
        to: rentalBoundary(addLocalDays(date, 1)),
      };
      if (peakOccupancy([...occupancy, self], day) <= owned) continue;
      holders.push({
        date,
        held: occupancy.filter(
          (o) =>
            o.from.getTime() < day.to.getTime() &&
            o.to.getTime() > day.from.getTime(),
        ),
      });
    }
    const rentalIds = [
      ...new Set(
        holders.flatMap((h) =>
          h.held.flatMap((o) => (o.rentalId ? [o.rentalId] : [])),
        ),
      ),
    ];
    const rentals = rentalIds.length
      ? await db.rental.findMany({
          where: { id: { in: rentalIds } },
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
        })
      : [];
    const rentalById = new Map(rentals.map((r) => [r.id, r]));

    result.conflicts = holders.map(({ date, held }) => {
      const quantityByRental = new Map<string, number>();
      for (const o of held) {
        if (o.rentalId) {
          quantityByRental.set(
            o.rentalId,
            (quantityByRental.get(o.rentalId) ?? 0) + o.quantity,
          );
        }
      }
      return {
        date,
        rentals: [...quantityByRental].flatMap(([rentalId, quantity]) => {
          const r = rentalById.get(rentalId);
          return r
            ? [
                {
                  rentalId,
                  code: rentalCode(rentalId),
                  orderId: r.orderId,
                  customerName: r.order.customer?.user.fullName ?? null,
                  startDate: r.startDate,
                  endDate: r.endDate,
                  quantity,
                },
              ]
            : [];
        }),
        cleanings: held.flatMap((o) =>
          o.cleaningId
            ? [{ cleaningId: o.cleaningId, startDate: o.from, endDate: o.to }]
            : [],
        ),
      };
    });
    return result;
  }

  private toRow(c: CleaningRow, now: Date) {
    const { variant, ...cleaning } = c;
    let state: RentalCleaningState = RentalCleaningState.CANCELLED;
    if (c.status === RentalCleaningStatus.ACTIVE) {
      if (now.getTime() < c.startDate.getTime()) {
        state = RentalCleaningState.PLANNED;
      } else if (now.getTime() < c.endDate.getTime()) {
        state = RentalCleaningState.IN_PROGRESS;
      } else {
        state = RentalCleaningState.DONE;
      }
    }
    return {
      ...cleaning,
      firstDay: toLocalDate(c.startDate),
      lastDay: addLocalDays(toLocalDate(c.endDate), -1),
      state,
      canCancel: state === RentalCleaningState.PLANNED,
      sku: variant.sku,
      productId: variant.product.id,
      productName: variant.product.name,
    };
  }

  async check(query: RentalCleaningCheckQuery, user: CurrentUser) {
    const storeId = await this.rentals.assertRentalStore(user);
    await this.rentals.assertWarehouse(user, storeId, query.warehouseId);
    const days = Number(query.days);
    const { start, end } = this.resolvePeriod(query.startDate, days);
    await this.assertVariant(this.prisma, storeId, query.variantId);
    try {
      return await this.evaluate(this.prisma, {
        warehouseId: query.warehouseId,
        variantId: query.variantId,
        startDate: query.startDate,
        days,
        start,
        end,
      });
    } catch (error: unknown) {
      this.rentals.fail(
        error,
        { variantId: query.variantId },
        'Failed to check dry cleaning',
      );
    }
  }

  async create(dto: CreateRentalCleaningDto, user: CurrentUser) {
    const storeId = await this.rentals.assertRentalStore(user);
    this.assertManager(user);
    await this.rentals.assertWarehouse(user, storeId, dto.warehouseId);
    const { start, end } = this.resolvePeriod(dto.startDate, dto.days);
    await this.assertVariant(this.prisma, storeId, dto.variantId);
    try {
      const cashbox = await resolvePaymentCashbox(this.prisma, user, {
        cashboxId: dto.cashboxId,
        warehouseId: dto.warehouseId,
      });
      const amount = new Prisma.Decimal(dto.amount);
      const cleaning = await this.prisma.$transaction(async (tx) => {
        // Same lock as bookings: no booking can take the unit meanwhile
        await this.availability.lockInventory(tx, dto.warehouseId, [
          dto.variantId,
        ]);
        const check = await this.evaluate(tx, {
          warehouseId: dto.warehouseId,
          variantId: dto.variantId,
          startDate: dto.startDate,
          days: dto.days,
          start,
          end,
        });
        if (!check.ok) {
          throw new ConflictException({
            code: RentalErrorCode.NOT_AVAILABLE,
            message: `No free unit of variant ${dto.variantId} for dry cleaning on these days (available: ${check.available})`,
            variantId: dto.variantId,
            available: check.available,
            conflicts: check.conflicts,
          });
        }
        const expense = await tx.cashTransaction.create({
          data: {
            cashboxId: cashbox.id,
            createdById: user.staff.id,
            type: CashTransactionType.EXPENSE,
            category: CashTransactionCategory.DRY_CLEANING,
            paymentType: dto.paymentType,
            amount,
            comment: dto.comment?.trim() || null,
          },
          select: { id: true },
        });
        await tx.cashbox.update({
          where: { id: cashbox.id },
          data: { balance: { decrement: amount } },
        });
        return tx.rentalCleaning.create({
          data: {
            storeId,
            warehouseId: dto.warehouseId,
            variantId: dto.variantId,
            startDate: start,
            endDate: end,
            days: dto.days,
            amount,
            paymentType: dto.paymentType,
            comment: dto.comment?.trim() || null,
            expenseTransactionId: expense.id,
            createdBy: user.staff.id,
          },
          select: CLEANING_SELECT,
        });
      });
      this.logger.info(
        {
          cleaningId: cleaning.id,
          variantId: dto.variantId,
          amount: amount.toString(),
          cashboxId: cashbox.id,
        },
        'Dry cleaning planned',
      );
      return this.toRow(cleaning, new Date());
    } catch (error: unknown) {
      this.rentals.fail(
        error,
        { variantId: dto.variantId },
        'Failed to plan dry cleaning',
      );
    }
  }

  async findAll(query: RentalCleaningListQuery, user: CurrentUser) {
    const storeId = await this.rentals.assertRentalStore(user);
    await this.rentals.assertWarehouse(user, storeId, query.warehouseId);
    const from = query.from ?? todayLocalDate();
    if (query.to && query.to < from) {
      throw new BadRequestException('from must not be after to');
    }
    try {
      const cleanings = await this.prisma.rentalCleaning.findMany({
        where: {
          storeId,
          warehouseId: query.warehouseId,
          status: RentalCleaningStatus.ACTIVE,
          ...(query.variantId ? { variantId: query.variantId } : {}),
          endDate: { gt: rentalBoundary(from) },
          ...(query.to
            ? { startDate: { lt: rentalBoundary(addLocalDays(query.to, 1)) } }
            : {}),
        },
        select: CLEANING_SELECT,
        orderBy: { startDate: 'asc' },
        take: MAX_LIST_ROWS,
      });
      const now = new Date();
      return cleanings.map((c) => this.toRow(c, now));
    } catch (error: unknown) {
      this.rentals.fail(
        error,
        { warehouseId: query.warehouseId },
        'Failed to list dry cleanings',
      );
    }
  }

  /**
   * Cancels a cleaning that has not started: the unit is free again and the
   * expense is written back to the cashbox (INCOME/DRY_CLEANING, same payment
   * type) — the expense cashbox if still open, else the employee's own.
   */
  async cancel(id: string, dto: CancelRentalCleaningDto, user: CurrentUser) {
    const storeId = await this.rentals.assertRentalStore(user);
    this.assertManager(user);
    const cleaning = await this.prisma.rentalCleaning.findUnique({
      where: { id },
      select: {
        id: true,
        storeId: true,
        warehouseId: true,
        amount: true,
        paymentType: true,
        comment: true,
        expenseTransaction: {
          select: {
            cashbox: {
              select: { id: true, storeId: true, status: true },
            },
          },
        },
      },
    });
    if (!cleaning || cleaning.storeId !== storeId) {
      throw new NotFoundException('Dry cleaning not found');
    }
    if (!this.rentals.hasWarehouseAccess(user, cleaning.warehouseId)) {
      throw new ForbiddenException('No access to this dry cleaning');
    }
    try {
      const expenseCashbox = cleaning.expenseTransaction.cashbox;
      const cashboxId =
        dto.cashboxId ??
        (expenseCashbox.status === CashStatus.OPEN &&
        expenseCashbox.storeId === storeId
          ? expenseCashbox.id
          : undefined);
      const cashbox = await resolvePaymentCashbox(this.prisma, user, {
        cashboxId,
        warehouseId: cleaning.warehouseId,
      });
      const now = new Date();
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "rental_cleanings" WHERE id = ${id} FOR UPDATE`;
        const current = await tx.rentalCleaning.findUniqueOrThrow({
          where: { id },
          select: { status: true, startDate: true },
        });
        if (current.status !== RentalCleaningStatus.ACTIVE) {
          throw new BadRequestException(
            'The dry cleaning is already cancelled',
          );
        }
        if (now.getTime() >= current.startDate.getTime()) {
          throw new BadRequestException(
            'The dry cleaning has already started and cannot be cancelled',
          );
        }
        const refund = await tx.cashTransaction.create({
          data: {
            cashboxId: cashbox.id,
            createdById: user.staff.id,
            type: CashTransactionType.INCOME,
            category: CashTransactionCategory.DRY_CLEANING,
            paymentType: cleaning.paymentType,
            amount: cleaning.amount,
            comment: cleaning.comment,
          },
          select: { id: true },
        });
        await tx.cashbox.update({
          where: { id: cashbox.id },
          data: { balance: { increment: cleaning.amount } },
        });
        return tx.rentalCleaning.update({
          where: { id },
          data: {
            status: RentalCleaningStatus.CANCELLED,
            refundTransactionId: refund.id,
            cancelledBy: user.staff.id,
            cancelledAt: now,
          },
          select: CLEANING_SELECT,
        });
      });
      this.logger.info(
        { cleaningId: id, cashboxId: cashbox.id },
        'Dry cleaning cancelled',
      );
      return this.toRow(updated, now);
    } catch (error: unknown) {
      this.rentals.fail(
        error,
        { cleaningId: id },
        'Failed to cancel dry cleaning',
      );
    }
  }
}
