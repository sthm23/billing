import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CreateCashBoxDto, CreateCashTransactionDto } from './dto/create-cashbox.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CashStatus, CashTransactionType, PaymentType, StaffRole, UserRole } from '@generated/enums';
import { CurrentUser } from '@auth/models/auth.model';
import { Prisma } from '@generated/client';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { DateRangeParams, resolveDateRange } from '@shared/dto/date-range.dto';

const PAYMENT_TYPES: PaymentType[] = [PaymentType.CASH, PaymentType.CARD, PaymentType.ONLINE, PaymentType.TRANSFER];

/** Cashboxes a user may see: owner/admin — the store; manager — their warehouses; others — their own. */
function cashboxScope(user: CurrentUser): Prisma.CashboxWhereInput {
  if (user.role === UserRole.ADMIN) return {};
  if (!user.staff) throw new ForbiddenException('Staff only');
  const where: Prisma.CashboxWhereInput = { storeId: user.staff.storeId };
  if (user.role === UserRole.OWNER || user.staff.role === StaffRole.OWNER) return where;
  if (user.staff.role === StaffRole.MANAGER) {
    return { ...where, warehouseId: { in: user.staff.warehouse.map((w) => w.warehouseId) } };
  }
  return { ...where, sellerId: user.staff.id };
}

@Injectable()
export class CashboxService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(CashboxService.name) private readonly logger: PinoLogger,
  ) { }

  /**
   * Opens a cashbox for the current employee. The store comes from the token;
   * the warehouse must belong to it (a manager — one of their warehouses).
   */
  async createCashBox(dto: CreateCashBoxDto, user: CurrentUser) {
    if (!user.staff) throw new ForbiddenException('Staff only');
    const storeId = user.staff.storeId;
    this.logger.debug({ storeId, warehouseId: dto.warehouseId, sellerId: user.staff.id }, 'Opening cashbox');
    try {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { id: dto.warehouseId, storeId },
      })
      if (!warehouse) {
        throw new BadRequestException('Warehouse does not belong to the store');
      }
      const isOwner = user.role === UserRole.ADMIN || user.role === UserRole.OWNER || user.staff.role === StaffRole.OWNER
      if (!isOwner && !user.staff.warehouse.some((w) => w.warehouseId === dto.warehouseId)) {
        throw new ForbiddenException('No access to this warehouse');
      }

      // One open cashbox per employee and warehouse
      const existingCashBox = await this.prisma.cashbox.findFirst({
        where: { storeId, warehouseId: dto.warehouseId, sellerId: user.staff.id, status: CashStatus.OPEN }
      })
      if (existingCashBox) {
        this.logger.warn({ storeId, warehouseId: dto.warehouseId }, 'Open cashbox already exists');
        throw new BadRequestException('You already have an open cashbox on this warehouse');
      }
      const cashbox = await this.prisma.cashbox.create({
        data: {
          storeId,
          sellerId: user.staff.id,
          warehouseId: dto.warehouseId,
          balance: dto.balance ?? 0,
          status: CashStatus.OPEN
        }
      });
      this.logger.info({ cashboxId: cashbox.id, storeId, sellerId: user.staff.id }, 'Cashbox opened');
      return cashbox;
    } catch (error: any) {
      this.logger.error({ storeId, err: error.message }, 'Failed to open cashbox');
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error.response || error.message)
    }
  }

  async closeCashBox(id: string, user: CurrentUser) {
    this.logger.debug({ cashboxId: id, sellerId: user.staff.id }, 'Closing cashbox');
    try {
      const param = {
        id,
        status: CashStatus.OPEN,
        storeId: user.staff.storeId,
      }

      if (user.role !== UserRole.ADMIN && user.role !== UserRole.OWNER) {
        param['warehouseId'] = user.staff.warehouse[0]?.warehouseId
        param['sellerId'] = user.staff.id
      }

      const existingCashBox = await this.prisma.cashbox.findFirst({
        where: { ...param }
      })
      if (!existingCashBox) {
        throw new BadRequestException('No OPEN cashbox found for this store and warehouse');
      }
      const closed = await this.prisma.cashbox.update({
        where: { id: existingCashBox.id },
        data: {
          status: CashStatus.CLOSED,
          closedAt: new Date(),
        }
      })
      this.logger.info({ cashboxId: existingCashBox.id, storeId: user.staff.storeId }, 'Cashbox closed');
      return closed;
    } catch (error: any) {
      this.logger.error({ cashboxId: id, err: error.message }, 'Failed to close cashbox');
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createCashTransaction(cashBoxId: string, dto: CreateCashTransactionDto, user: CurrentUser) {
    this.logger.debug({ cashboxId: cashBoxId, amount: dto.amount, type: dto.type, category: dto.category }, 'Creating cash transaction');
    try {
      const param = {
        id: cashBoxId,
        storeId: user.staff.storeId,
      }
      if (user.role !== UserRole.ADMIN && user.role !== UserRole.OWNER) {
        param['warehouseId'] = user.staff.warehouse[0]?.warehouseId
        param['sellerId'] = user.staff.id
      }
      const cashBox = await this.prisma.cashbox.findUnique({
        where: { ...param },
      })
      if (!cashBox) {
        throw new BadRequestException('Cashbox not found');
      }
      if (cashBox.status !== CashStatus.OPEN) {
        throw new BadRequestException('Cannot add transaction to a cashbox that is not OPEN');
      }
      await this.prisma.$transaction(async (prisma) => {
        await prisma.cashTransaction.create({
          data: {
            cashboxId: cashBox.id,
            amount: dto.amount,
            type: dto.type,
            createdById: user.staff.id,
            category: dto.category,
            comment: dto.comment,
            paymentType: dto.paymentType as PaymentType,
            orderId: dto.orderId ?? null
          }
        })
        const balance = dto.type === CashTransactionType.INCOME ? { increment: new Prisma.Decimal(dto.amount) } : { decrement: new Prisma.Decimal(dto.amount) }
        await prisma.cashbox.update({
          where: { id: cashBox.id },
          data: {
            balance,
          }
        })
      })
      this.logger.info({ cashboxId: cashBoxId, amount: dto.amount, type: dto.type }, 'Cash transaction created');
      return { message: 'Cash transaction added successfully' };
    } catch (error: any) {
      this.logger.error({ cashboxId: cashBoxId, err: error.message }, 'Failed to create cash transaction');
      throw new BadRequestException(error.response || error.message)
    }
  }

  /**
   * Cashboxes in the user's scope, newest first, plus `today`: open cashboxes
   * (count, balance), their income/expense in `[from, to)` (all payment
   * methods) and the last closing time.
   */
  async findAll(params: PaginationParams & DateRangeParams, user: CurrentUser) {
    const scope = cashboxScope(user);
    try {
      const { currentPage = 1, pageSize = 10 } = params
      const skip = (currentPage - 1) * pageSize;
      const { from, to } = resolveDateRange(params);
      const openWhere: Prisma.CashboxWhereInput = { ...scope, status: CashStatus.OPEN };

      const [totalItems, cashboxes, open, todayByType, lastClosed] = await Promise.all([
        this.prisma.cashbox.count({ where: scope }),
        this.prisma.cashbox.findMany({
          where: scope,
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' }
            },
            seller: {
              include: {
                user: true
              }
            },
            warehouse: true
          },
          skip: skip,
          take: +pageSize,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.cashbox.aggregate({ where: openWhere, _count: { _all: true }, _sum: { balance: true } }),
        this.prisma.cashTransaction.groupBy({
          by: ['type'],
          where: { cashbox: openWhere, createdAt: { gte: from, lt: to } },
          _sum: { amount: true },
        }),
        this.prisma.cashbox.findFirst({
          where: { ...scope, status: CashStatus.CLOSED, closedAt: { not: null } },
          orderBy: { closedAt: 'desc' },
          select: { closedAt: true },
        }),
      ]);
      const sumOf = (type: CashTransactionType) =>
        Number(todayByType.find((g) => g.type === type)?._sum.amount ?? 0);

      return {
        data: cashboxes,
        total: totalItems,
        currentPage,
        pageSize,
        today: {
          from,
          to,
          openCount: open._count._all,
          balance: Number(open._sum.balance ?? 0),
          income: sumOf(CashTransactionType.INCOME),
          expense: sumOf(CashTransactionType.EXPENSE),
          lastClosedAt: lastClosed?.closedAt ?? null,
        },
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  /** Open cashboxes of the user's store (any employee): where a debt repayment can go. */
  async findOpen(user: CurrentUser) {
    if (!user.staff) throw new ForbiddenException('Staff only');
    try {
      const cashboxes = await this.prisma.cashbox.findMany({
        where: { storeId: user.staff.storeId, status: CashStatus.OPEN },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          balance: true,
          createdAt: true,
          warehouse: { select: { id: true, name: true } },
          seller: { select: { id: true, user: { select: { fullName: true } } } },
        },
      });
      return cashboxes.map((c) => ({
        id: c.id,
        balance: Number(c.balance),
        createdAt: c.createdAt,
        warehouse: c.warehouse,
        seller: { id: c.seller.id, fullName: c.seller.user.fullName },
        isMine: c.seller.id === user.staff.id,
      }));
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  /** One cashbox with its transactions and `summary`: income, expense and net per payment method. */
  async findOne(id: string, user: CurrentUser) {
    const scope = cashboxScope(user);
    try {
      const cashbox = await this.prisma.cashbox.findFirst({
        where: { ...scope, id },
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' }
          },
          seller: {
            include: {
              user: true
            }
          },
          warehouse: true
        }
      });
      if (!cashbox) {
        throw new BadRequestException('Cashbox not found');
      }
      const groups = await this.prisma.cashTransaction.groupBy({
        by: ['type', 'paymentType'],
        where: { cashboxId: cashbox.id },
        _sum: { amount: true },
      });
      const amountOf = (type: CashTransactionType, paymentType?: PaymentType) =>
        groups
          .filter((g) => g.type === type && (!paymentType || g.paymentType === paymentType))
          .reduce((sum, g) => sum + Number(g._sum.amount ?? 0), 0);

      return {
        ...cashbox,
        summary: {
          income: amountOf(CashTransactionType.INCOME),
          expense: amountOf(CashTransactionType.EXPENSE),
          byMethod: PAYMENT_TYPES.map((paymentType) => ({
            paymentType,
            net: amountOf(CashTransactionType.INCOME, paymentType) - amountOf(CashTransactionType.EXPENSE, paymentType),
          })),
        },
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}
