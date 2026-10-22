import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CreateDebtDto, CreateDebtPaymentDto } from './dto/create-debt.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CashTransactionCategory, CashTransactionType, DebtStatus, OrderStatus } from '@generated/enums';
import { Prisma } from '@generated/client';
import { resolvePaymentCashbox } from 'src/cashbox/payment-cashbox';
import { resolveDateRange } from '@shared/dto/date-range.dto';
import { CurrentUser } from '@auth/models/auth.model';
import { DebtQueryParams, DebtorsQueryParams } from './dto/param.dto';

@Injectable()
export class DebtService {

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(DebtService.name) private readonly logger: PinoLogger,
  ) { }

  async createCustomerDebt(dto: CreateDebtDto, user: CurrentUser) {
    try {
      if (user.staff && user.staff.storeId !== dto.storeId) {
        throw new BadRequestException('Wrong StoreId given!')
      }

      const debt = await this.prisma.customerDebt.create({
        data: {
          storeId: dto.storeId,
          customerId: dto.customerId,
          description: dto.description ?? null,
          totalAmount: dto.amount,
          paidAmount: 0,
          status: DebtStatus.ACTIVE,
          createdAt: dto.createdAt ?? new Date(),
          returnedAt: dto.returnedAt ?? new Date(),
        }
      });
      this.logger.info({ debtId: debt.id, customerId: dto.customerId, amount: dto.amount }, 'Customer debt created');
      return debt;
    } catch (err: any) {
      this.logger.error({ customerId: dto.customerId, err: err.message }, 'Failed to create customer debt');
      throw new BadRequestException(err.response || err.message)
    }
  }

  /**
   * Repays a manual debt. Any employee of the store; the money goes to their
   * own open cashbox or the chosen open cashbox of the store. The debt must be
   * ACTIVE and the payment may not exceed what is left.
   */
  async createDebtPayment(dto: CreateDebtPaymentDto, user: CurrentUser) {
    this.logger.debug({ debtId: dto.debtId, cashboxId: dto.cashboxId }, 'Processing debt payment');
    const staff = this.requireStaff(user);
    try {
      const debt = await this.prisma.customerDebt.findUnique({ where: { id: dto.debtId } });
      if (!debt) {
        throw new BadRequestException('Долг не найден');
      }
      if (debt.storeId !== staff.storeId) {
        throw new ForbiddenException('No access to this debt');
      }
      if (debt.status !== DebtStatus.ACTIVE) {
        throw new BadRequestException('Долг уже погашен');
      }
      const totalPaymentAmount = dto.payments.reduce((sum, payment) => sum + +payment.amount, 0);
      const remaining = +debt.totalAmount - +debt.paidAmount;
      if (totalPaymentAmount > remaining) {
        throw new BadRequestException('Сумма оплаты больше остатка долга');
      }
      const cashBox = await resolvePaymentCashbox(this.prisma, user, {
        cashboxId: dto.cashboxId,
        warehouseId: dto.warehouseId,
      });

      return await this.prisma.$transaction(async (prisma) => {
        for (const payment of dto.payments) {
          const debtPayment = await prisma.debtPayment.create({
            data: {
              debtId: debt.id,
              amount: payment.amount,
              type: payment.type,
              createdBy: staff.id,
            },
          });
          // Same as order payments: every method goes to the cashbox
          await prisma.cashTransaction.create({
            data: {
              cashboxId: cashBox.id,
              amount: payment.amount,
              type: CashTransactionType.INCOME,
              category: CashTransactionCategory.DEBT_PAYMENT,
              paymentType: payment.type,
              createdById: staff.id,
              debtId: debtPayment.id,
            },
          });
        }

        await prisma.cashbox.update({
          where: { id: cashBox.id },
          data: { balance: { increment: totalPaymentAmount } },
        });

        const newPaidAmount = +debt.paidAmount + totalPaymentAmount;
        const updated = await prisma.customerDebt.update({
          where: { id: debt.id },
          data: {
            paidAmount: { increment: totalPaymentAmount },
            status: newPaidAmount >= +debt.totalAmount ? DebtStatus.PAID : DebtStatus.ACTIVE,
          },
        });
        this.logger.info({ debtId: debt.id, amount: totalPaymentAmount, status: updated.status, cashboxId: cashBox.id }, 'Debt payment processed');
        return updated;
      });
    } catch (error: any) {
      this.logger.error({ debtId: dto.debtId, err: error.message }, 'Failed to process debt payment');
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findAll({ pageSize = 10, currentPage = 1, status, customerId, fromDate, toDate }: DebtQueryParams, user: CurrentUser) {
    const staff = this.requireStaff(user);
    try {
      const where: Prisma.CustomerDebtWhereInput = { storeId: staff.storeId };
      if (status) where.status = status;
      if (customerId) where.customerId = customerId;
      if (fromDate || toDate) {
        where.createdAt = {
          ...(fromDate ? { gte: new Date(fromDate) } : {}),
          ...(toDate ? { lte: new Date(toDate) } : {}),
        };
      }

      const [result, total] = await Promise.all([
        this.prisma.customerDebt.findMany({
          where,
          skip: (+currentPage - 1) * +pageSize,
          take: +pageSize,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: { include: { user: true } },
            payments: true,
          },
        }),
        this.prisma.customerDebt.count({ where }),
      ]);
      return { data: result, total, currentPage: +currentPage, pageSize: +pageSize };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findOne(id: string, user: CurrentUser) {
    const staff = this.requireStaff(user);
    try {
      const debt = await this.prisma.customerDebt.findFirst({
        where: { id, storeId: staff.storeId },
        include: {
          customer: { include: { user: true } },
          payments: true,
        },
      });
      if (!debt) throw new BadRequestException('Долг не найден');
      return debt;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  /**
   * Debtors of the store (any employee): DEBT orders + ACTIVE manual debts,
   * grouped by customer, with totals. DEBT orders without a customer (older
   * data) come as `unassigned` and count in the totals. `from`/`to` bound
   * «paid this month».
   */
  async getDebtors(params: DebtorsQueryParams, user: CurrentUser) {
    const staff = this.requireStaff(user);
    const storeId = staff.storeId;
    try {
      const { from, to } = params.from ? resolveDateRange(params) : currentMonthRange();
      const [orders, debts, paid] = await Promise.all([
        this.prisma.order.findMany({
          where: { storeId, status: OrderStatus.DEBT },
          select: {
            customerId: true,
            totalAmount: true,
            paidAmount: true,
            returnedAmount: true,
            soldAt: true,
            createdAt: true,
            customer: { select: { user: { select: { fullName: true, phone: true } } } },
            payments: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          },
        }),
        this.prisma.customerDebt.findMany({
          where: { storeId, status: DebtStatus.ACTIVE },
          select: {
            customerId: true,
            totalAmount: true,
            paidAmount: true,
            createdAt: true,
            customer: { select: { user: { select: { fullName: true, phone: true } } } },
            payments: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          },
        }),
        this.prisma.cashTransaction.aggregate({
          where: {
            category: CashTransactionCategory.DEBT_PAYMENT,
            type: CashTransactionType.INCOME,
            cashbox: { storeId },
            createdAt: { gte: from, lt: to },
          },
          _sum: { amount: true },
        }),
      ]);

      const now = Date.now();
      const over30Before = now - 30 * DAY_MS;
      const byCustomer = new Map<string, DebtorRow>();
      let over30 = 0;

      const add = (
        customerId: string,
        user: { fullName: string; phone: string },
        remaining: number,
        since: Date,
        lastPayment: Date | undefined,
        kind: 'order' | 'manual',
      ) => {
        if (remaining <= 0) return;
        if (since.getTime() < over30Before) over30 += remaining;
        const row = byCustomer.get(customerId) ?? {
          customerId,
          fullName: user.fullName,
          phone: user.phone,
          total: 0,
          ordersCount: 0,
          debtsCount: 0,
          lastPaymentAt: null,
          since,
          ageDays: 0,
        };
        row.total += remaining;
        if (kind === 'order') row.ordersCount += 1;
        else row.debtsCount += 1;
        if (since < row.since) row.since = since;
        if (lastPayment && (!row.lastPaymentAt || lastPayment > row.lastPaymentAt)) {
          row.lastPaymentAt = lastPayment;
        }
        byCustomer.set(customerId, row);
      };

      // DEBT orders without a customer: one separate row
      let unassigned: Omit<DebtorRow, 'customerId' | 'fullName' | 'phone' | 'debtsCount'> | null = null;
      for (const o of orders) {
        if (!o.customerId || !o.customer) {
          const remaining = +o.totalAmount - +o.returnedAmount - +o.paidAmount;
          if (remaining <= 0) continue;
          const since = o.soldAt ?? o.createdAt;
          const lastPayment = o.payments[0]?.createdAt;
          if (since.getTime() < over30Before) over30 += remaining;
          unassigned ??= { total: 0, ordersCount: 0, lastPaymentAt: null, since, ageDays: 0 };
          unassigned.total += remaining;
          unassigned.ordersCount += 1;
          if (since < unassigned.since) unassigned.since = since;
          if (lastPayment && (!unassigned.lastPaymentAt || lastPayment > unassigned.lastPaymentAt)) {
            unassigned.lastPaymentAt = lastPayment;
          }
          continue;
        }
        add(
          o.customerId,
          o.customer.user,
          +o.totalAmount - +o.returnedAmount - +o.paidAmount,
          o.soldAt ?? o.createdAt,
          o.payments[0]?.createdAt,
          'order',
        );
      }
      for (const d of debts) {
        add(d.customerId, d.customer.user, +d.totalAmount - +d.paidAmount, d.createdAt, d.payments[0]?.createdAt, 'manual');
      }

      const all = [...byCustomer.values()].map((row) => ({
        ...row,
        ageDays: Math.floor((now - row.since.getTime()) / DAY_MS),
      }));
      const search = params.search?.trim().toLowerCase();
      const data = (search
        ? all.filter((r) => r.fullName.toLowerCase().includes(search) || r.phone.toLowerCase().includes(search))
        : all
      ).sort((a, b) => (params.sort === 'date' ? a.since.getTime() - b.since.getTime() : b.total - a.total));

      return {
        summary: {
          total: all.reduce((sum, r) => sum + r.total, 0) + (unassigned?.total ?? 0),
          customers: all.length,
          over30,
          paidInPeriod: Number(paid._sum.amount ?? 0),
          from,
          to,
        },
        data,
        unassigned: unassigned
          ? { ...unassigned, ageDays: Math.floor((now - unassigned.since.getTime()) / DAY_MS) }
          : null,
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  /**
   * All open debts of one customer in the store, oldest first, with payments.
   * `customerId: null` — DEBT orders without a customer (`customer: null`).
   */
  async getDebtor(customerId: string | null, user: CurrentUser) {
    const staff = this.requireStaff(user);
    const storeId = staff.storeId;
    try {
      const customer = customerId
        ? await this.prisma.customer.findUnique({
            where: { id: customerId },
            select: { id: true, user: { select: { fullName: true, phone: true } } },
          })
        : null;
      if (customerId && !customer) throw new BadRequestException('Customer not found');

      const paymentSelect = {
        id: true,
        amount: true,
        type: true,
        createdAt: true,
        cashier: { select: { user: { select: { fullName: true } } } },
      } as const;
      const [orders, debts] = await Promise.all([
        this.prisma.order.findMany({
          where: { storeId, customerId, status: OrderStatus.DEBT },
          include: {
            warehouse: { select: { id: true, name: true } },
            payments: { select: paymentSelect, orderBy: { createdAt: 'asc' } },
          },
        }),
        // Manual debts always have a customer
        customerId
          ? this.prisma.customerDebt.findMany({
              where: { storeId, customerId, status: DebtStatus.ACTIVE },
              include: { payments: { select: paymentSelect, orderBy: { createdAt: 'asc' } } },
            })
          : Promise.resolve([]),
      ]);

      const toPayment = (p: { id: string; amount: Prisma.Decimal; type: string; createdAt: Date; cashier: { user: { fullName: string } } | null }) => ({
        id: p.id,
        amount: Number(p.amount),
        type: p.type,
        createdAt: p.createdAt,
        createdBy: p.cashier?.user.fullName ?? null,
      });
      const items = [
        ...orders.map((o) => {
          const total = +o.totalAmount - +o.returnedAmount;
          return {
            kind: 'ORDER' as const,
            id: o.id,
            date: o.soldAt ?? o.createdAt,
            description: null,
            warehouse: o.warehouse,
            total,
            paid: +o.paidAmount,
            remaining: total - +o.paidAmount,
            payments: o.payments.map(toPayment),
          };
        }),
        ...debts.map((d) => ({
          kind: 'MANUAL' as const,
          id: d.id,
          date: d.createdAt,
          description: d.description,
          warehouse: null,
          total: +d.totalAmount,
          paid: +d.paidAmount,
          remaining: +d.totalAmount - +d.paidAmount,
          payments: d.payments.map(toPayment),
        })),
      ]
        .filter((i) => i.remaining > 0)
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      return {
        customer: customer
          ? { id: customer.id, fullName: customer.user.fullName, phone: customer.user.phone }
          : null,
        total: items.reduce((sum, i) => sum + i.remaining, 0),
        debts: items,
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  private requireStaff(user: CurrentUser) {
    if (!user.staff) throw new ForbiddenException('Staff only');
    return user.staff;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface DebtorRow {
  customerId: string;
  fullName: string;
  phone: string;
  /** Unpaid amount over all open debts */
  total: number;
  ordersCount: number;
  debtsCount: number;
  lastPaymentAt: Date | null;
  /** Date of the oldest open debt */
  since: Date;
  ageDays: number;
}

/** The current calendar month (server time) — default period for «paid». */
function currentMonthRange() {
  const from = new Date();
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setMonth(to.getMonth() + 1);
  return { from, to };
}
