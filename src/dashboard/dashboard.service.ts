import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@generated/client';
import {
  CashTransactionCategory,
  CashTransactionType,
  PaymentType,
  ReturnReason,
  StaffRole,
  UserRole,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { CurrentUser } from '@auth/models/auth.model';
import { assertWarehouseAccess } from '@shared/helper/warehouse-access.helper';
import {
  addLocalDays,
  rentalBoundary,
  todayLocalDate,
} from '../rental/rental-days';
import { DashboardParams } from './dto/dashboard-params.dto';
import {
  DAY_MS,
  HOUR_MS,
  HOURS_IN_DAY,
  MAX_PERIOD_DAYS,
  MIN_WAREHOUSES_FOR_SPLIT,
  PAYMENT_TYPES_ORDER,
  PURCHASE_CATEGORY,
  RENTAL_OUT_STATUSES,
  REPORT_TIME_ZONE,
  REPORT_UTC_OFFSET_MS,
  RETURN_REASONS_ORDER,
} from './dashboard.constants';

export type Granularity = 'hour' | 'day';

export interface DashboardPeriod {
  from: Date;
  to: Date;
  granularity: Granularity;
}

/** `GET /dashboard/team`: sales by staff and by warehouse. */
export interface DashboardTeam {
  period: DashboardPeriod;
  warehouseId: string | null;
  /** Everyone who sold in the period (by `cashierId`), largest first */
  staff: { staffId: string; name: string; sales: number; orders: number }[];
  /** null with a warehouse filter or when the store has one warehouse */
  warehouses:
    | {
        warehouseId: string;
        name: string;
        sales: number;
        orders: number;
        /** sales / store sales (0..1) */
        share: number;
      }[]
    | null;
}

/** `GET /dashboard/activity`: hours, returns, rental. */
export interface DashboardActivity {
  period: DashboardPeriod;
  warehouseId: string | null;
  hours: {
    /** Days the average is taken over */
    days: number;
    /** Local hours 0–23: average sales per day, total orders */
    points: { hour: number; avgSales: number; orders: number }[];
    peakHour: number | null;
    /** Quietest hour that still sold something; null with fewer than 2 such hours */
    quietHour: number | null;
  };
  returns: {
    amount: number;
    count: number;
    /** returns / sales of the period (0..); null without sales */
    share: number | null;
    byReason: { reason: ReturnReason; count: number; amount: number }[];
  };
  /** null when rental is off for the store */
  rental: {
    /** Rental cash in − prepayments paid back, in the period */
    income: number;
    /** Units out now (issued, not returned) */
    out: number;
    dueToday: number;
    overdue: number;
  } | null;
}

/** Resolved request: the owner's store, optional warehouse, period. */
interface Scope {
  storeId: string;
  warehouseId: string | null;
  from: Date;
  to: Date;
  granularity: Granularity;
}

/** Raw numeric value from `$queryRaw` (Decimal, bigint, number or null). */
type RawNumber = Prisma.Decimal | bigint | number | string | null;

export interface DashboardSummary {
  period: DashboardPeriod;
  warehouseId: string | null;
  kpi: {
    /** Σ `totalAmount` of the orders sold in the period (debt orders included, rental excluded) */
    sales: number;
    /** Value of the goods returned in the period (by return date) */
    returns: number;
    /** sales − returns */
    revenue: number;
    /** cost of the sold goods − cost of the returned goods */
    cost: number;
    profit: number;
    /** profit / revenue (0..1); null when revenue ≤ 0 */
    margin: number | null;
    orders: number;
    items: number;
    avgCheck: number;
  };
  chart: { at: Date; sales: number; orders: number }[];
  payments: {
    /** Money paid at the sale moment by the orders sold in the period */
    byType: { type: PaymentType; amount: number }[];
    received: number;
    /** sales − received: what was sold on debt */
    debtGiven: number;
  };
  cashflow: {
    /** Σ INCOME of the cashboxes */
    income: number;
    /** EXPENSE by category (purchases excluded), largest first, only > 0 */
    expenses: { category: CashTransactionCategory; amount: number }[];
    expensesTotal: number;
    purchase: number;
    /** income − expenses − purchase */
    net: number;
  };
  topProducts: {
    productId: string;
    name: string;
    amount: number;
    quantity: number;
  }[];
  debts: {
    given: number;
    repaid: number;
    /** The store's open debt now (as «Должники»); null with a warehouse filter */
    outstandingNow: number | null;
  };
}

const TOP_PRODUCTS = 5;

/**
 * Owner dashboard (billing/docs/dashboard/PLAN.md). Event-dated: a sale counts
 * on its `soldAt`, a return on its own date, cash on its transaction date —
 * so a past period never changes. Rental orders are never sales.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    params: DashboardParams,
    user: CurrentUser,
  ): Promise<DashboardSummary> {
    const scope = await this.resolveScope(params, user);
    const sold = this.soldOrders(scope);

    const [
      totals,
      returns,
      chartRows,
      paymentRows,
      topRows,
      cash,
      outstanding,
    ] = await Promise.all([
      this.salesTotals(scope),
      this.returnsTotals(scope),
      this.prisma.$queryRaw<
        { key: string; sales: RawNumber; orders: number }[]
      >`/* dashboard:chart */
          SELECT to_char(${this.localTime(Prisma.sql`o."soldAt"`)}, ${scope.granularity === 'hour' ? 'YYYY-MM-DD HH24' : 'YYYY-MM-DD'}) AS key,
                 SUM(o."totalAmount") AS sales,
                 COUNT(*)::int AS orders
          FROM orders o
          WHERE ${sold}
          GROUP BY 1`,
      // Sale payments are written as SALE cash income in the pay transaction;
      // later repayments are DEBT_PAYMENT and count in «Погашено»
      this.prisma.$queryRaw<{ type: PaymentType; amount: RawNumber }[]>`
          /* dashboard:payments */
          SELECT ct."paymentType"::text AS type, SUM(ct.amount) AS amount
          FROM "CashTransaction" ct
          JOIN orders o ON o.id = ct."orderId"
          WHERE ${sold}
            AND ct.type = 'INCOME' AND ct.category = 'SALE'
          GROUP BY 1`,
      this.prisma.$queryRaw<
        {
          productId: string;
          name: string;
          amount: RawNumber;
          quantity: RawNumber;
        }[]
      >`/* dashboard:top */
          SELECT p.id AS "productId", p.name,
                 SUM((oi."retailPrice" - oi.sale) * oi.quantity) AS amount,
                 SUM(oi.quantity) AS quantity
          FROM order_items oi
          JOIN orders o ON o.id = oi."orderId"
          JOIN product_variants v ON v.id = oi."variantId"
          JOIN products p ON p.id = v."productId"
          WHERE ${sold}
          GROUP BY p.id, p.name
          ORDER BY amount DESC
          LIMIT ${TOP_PRODUCTS}`,
      this.prisma.cashTransaction.groupBy({
        by: ['type', 'category'],
        where: {
          createdAt: { gte: scope.from, lt: scope.to },
          cashbox: {
            storeId: scope.storeId,
            ...(scope.warehouseId ? { warehouseId: scope.warehouseId } : {}),
          },
        },
        _sum: { amount: true },
      }),
      // Manual debts have no warehouse: the open total only for the whole store
      scope.warehouseId
        ? Promise.resolve(null)
        : this.prisma.$queryRaw<{ orders: RawNumber; manual: RawNumber }[]>`
              /* dashboard:outstanding */
              SELECT
                (SELECT COALESCE(SUM(GREATEST(o."totalAmount" - o."returnedAmount" - o."paidAmount", 0)), 0)
                   FROM orders o WHERE o."storeId" = ${scope.storeId} AND o.status = 'DEBT') AS orders,
                (SELECT COALESCE(SUM(GREATEST(d."totalAmount" - d."paidAmount", 0)), 0)
                   FROM "CustomerDebt" d WHERE d."storeId" = ${scope.storeId} AND d.status = 'ACTIVE') AS manual`,
    ]);

    const sales = totals.sales;
    const orders = totals.orders;
    const returnsAmount = returns.amount;
    const revenue = sales - returnsAmount;
    const cost = totals.cost - returns.cost;
    const profit = revenue - cost;

    const paidByType = new Map(
      paymentRows.map((row) => [row.type, money(row.amount)]),
    );
    const byType = PAYMENT_TYPES_ORDER.map((type) => ({
      type,
      amount: paidByType.get(type) ?? 0,
    }));
    const received = byType.reduce((sum, p) => sum + p.amount, 0);
    const debtGiven = Math.max(0, sales - received);

    const cashflow = this.cashflow(cash);
    const repaid = cash
      .filter(
        (row) =>
          row.type === CashTransactionType.INCOME &&
          row.category === CashTransactionCategory.DEBT_PAYMENT,
      )
      .reduce((sum, row) => sum + money(row._sum.amount), 0);
    const o = outstanding?.[0];

    return {
      period: this.period(scope),
      warehouseId: scope.warehouseId,
      kpi: {
        sales,
        returns: returnsAmount,
        revenue,
        cost,
        profit,
        margin: revenue > 0 ? profit / revenue : null,
        orders,
        items: totals.items,
        avgCheck: orders > 0 ? Math.round(sales / orders) : 0,
      },
      chart: this.chart(scope, chartRows),
      payments: { byType, received, debtGiven },
      cashflow,
      topProducts: topRows.map((row) => ({
        productId: row.productId,
        name: row.name,
        amount: money(row.amount),
        quantity: num(row.quantity),
      })),
      debts: {
        given: debtGiven,
        repaid,
        outstandingNow: o ? money(o.orders) + money(o.manual) : null,
      },
    };
  }

  async getTeam(
    params: DashboardParams,
    user: CurrentUser,
  ): Promise<DashboardTeam> {
    const scope = await this.resolveScope(params, user);
    const sold = this.soldOrders(scope);
    // The warehouse split only makes sense for the whole store
    const byWarehouse = !scope.warehouseId;

    const [staffRows, warehouseRows, warehouses] = await Promise.all([
      this.prisma.$queryRaw<
        { staffId: string; name: string; sales: RawNumber; orders: number }[]
      >`/* dashboard:staff */
          SELECT o."cashierId" AS "staffId", u."fullName" AS name,
                 SUM(o."totalAmount") AS sales, COUNT(*)::int AS orders
          FROM orders o
          JOIN staff s ON s.id = o."cashierId"
          JOIN users u ON u.id = s."userId"
          WHERE ${sold}
          GROUP BY 1, 2
          ORDER BY sales DESC`,
      byWarehouse
        ? this.prisma.$queryRaw<
            { warehouseId: string; sales: RawNumber; orders: number }[]
          >`/* dashboard:warehouses */
              SELECT o."warehouseId" AS "warehouseId",
                     SUM(o."totalAmount") AS sales, COUNT(*)::int AS orders
              FROM orders o
              WHERE ${sold}
              GROUP BY 1`
        : Promise.resolve(
            [] as { warehouseId: string; sales: RawNumber; orders: number }[],
          ),
      byWarehouse
        ? this.prisma.warehouse.findMany({
            where: { storeId: scope.storeId },
            select: { id: true, name: true, isActive: true },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve(
            [] as { id: string; name: string; isActive: boolean }[],
          ),
    ]);

    const staff = staffRows.map((row) => ({
      staffId: row.staffId,
      name: row.name,
      sales: money(row.sales),
      orders: row.orders,
    }));

    const salesBy = new Map(warehouseRows.map((row) => [row.warehouseId, row]));
    // An inactive warehouse is listed only when it sold something
    const rows = warehouses
      .filter((w) => w.isActive || salesBy.has(w.id))
      .map((w) => ({
        warehouseId: w.id,
        name: w.name,
        sales: money(salesBy.get(w.id)?.sales),
        orders: salesBy.get(w.id)?.orders ?? 0,
      }));
    const total = rows.reduce((sum, w) => sum + w.sales, 0);

    return {
      period: this.period(scope),
      warehouseId: scope.warehouseId,
      staff,
      warehouses:
        rows.length >= MIN_WAREHOUSES_FOR_SPLIT
          ? rows
              .map((w) => ({ ...w, share: total > 0 ? w.sales / total : 0 }))
              .sort((a, b) => b.sales - a.sales)
          : null,
    };
  }

  async getActivity(
    params: DashboardParams,
    user: CurrentUser,
  ): Promise<DashboardActivity> {
    const scope = await this.resolveScope(params, user);
    const sold = this.soldOrders(scope);

    const [hourRows, totals, returns, reasonRows, store] = await Promise.all([
      this.prisma.$queryRaw<
        { hour: number; sales: RawNumber; orders: number }[]
      >`/* dashboard:hours */
          SELECT EXTRACT(HOUR FROM ${this.localTime(Prisma.sql`o."soldAt"`)})::int AS hour,
                 SUM(o."totalAmount") AS sales, COUNT(*)::int AS orders
          FROM orders o
          WHERE ${sold}
          GROUP BY 1`,
      this.salesTotals(scope),
      this.returnsTotals(scope),
      this.prisma.$queryRaw<
        { reason: ReturnReason; count: number; amount: RawNumber }[]
      >`/* dashboard:reasons */
          SELECT ro.reason::text AS reason, COUNT(*)::int AS count,
                 COALESCE(SUM(ro."totalAmount"), 0) AS amount
          FROM "ReturnedOrder" ro
          JOIN orders o ON o.id = ro."orderId"
          WHERE ${this.returnsInPeriod(scope)}
          GROUP BY 1`,
      this.prisma.store.findUnique({
        where: { id: scope.storeId },
        select: { rentalEnabled: true },
      }),
    ]);

    const reasonsBy = new Map(reasonRows.map((row) => [row.reason, row]));

    return {
      period: this.period(scope),
      warehouseId: scope.warehouseId,
      hours: this.hours(scope, hourRows),
      returns: {
        amount: returns.amount,
        count: returns.count,
        share: totals.sales > 0 ? returns.amount / totals.sales : null,
        byReason: RETURN_REASONS_ORDER.map((reason) => ({
          reason,
          count: reasonsBy.get(reason)?.count ?? 0,
          amount: money(reasonsBy.get(reason)?.amount),
        })),
      },
      rental: store?.rentalEnabled ? await this.rental(scope) : null,
    };
  }

  /** Orders sold in the period: count, sales, sold units, their cost. */
  private async salesTotals(
    scope: Scope,
  ): Promise<{ orders: number; sales: number; items: number; cost: number }> {
    const rows = await this.prisma.$queryRaw<
      { orders: number; sales: RawNumber; items: RawNumber; cost: RawNumber }[]
    >`/* dashboard:sales */
        SELECT COUNT(*)::int AS orders,
               COALESCE(SUM(o."totalAmount"), 0) AS sales,
               COALESCE(SUM(i.qty), 0) AS items,
               COALESCE(SUM(i.cost), 0) AS cost
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT SUM(oi.quantity) AS qty, SUM(oi."costAtSale" * oi.quantity) AS cost
          FROM order_items oi WHERE oi."orderId" = o.id
        ) i ON true
        WHERE ${this.soldOrders(scope)}`;
    const row = rows[0];

    return {
      orders: row?.orders ?? 0,
      sales: money(row?.sales),
      items: num(row?.items),
      cost: money(row?.cost),
    };
  }

  /** Returns made in the period: count, value of the goods, their cost. */
  private async returnsTotals(
    scope: Scope,
  ): Promise<{ count: number; amount: number; cost: number }> {
    const rows = await this.prisma.$queryRaw<
      { count: number; amount: RawNumber; cost: RawNumber }[]
    >`/* dashboard:returns */
        SELECT COUNT(*)::int AS count,
               COALESCE(SUM(ro."totalAmount"), 0) AS amount,
               COALESCE(SUM(rc.cost), 0) AS cost
        FROM "ReturnedOrder" ro
        JOIN orders o ON o.id = ro."orderId"
        LEFT JOIN LATERAL (
          SELECT SUM(ri.quantity * oi."costAtSale") AS cost
          FROM "ReturnItem" ri JOIN order_items oi ON oi.id = ri."itemId"
          WHERE ri."returnId" = ro.id
        ) rc ON true
        WHERE ${this.returnsInPeriod(scope)}`;
    const row = rows[0];

    return {
      count: row?.count ?? 0,
      amount: money(row?.amount),
      cost: money(row?.cost),
    };
  }

  /**
   * Rental card: income of the period (rental cash in − prepayments paid back)
   * and the units out **now**, with the same «return today» / «overdue» rules
   * as the rental lists.
   */
  private async rental(
    scope: Scope,
  ): Promise<NonNullable<DashboardActivity['rental']>> {
    const warehouse = scope.warehouseId
      ? { warehouseId: scope.warehouseId }
      : {};
    const [cash, active] = await Promise.all([
      this.prisma.cashTransaction.groupBy({
        by: ['type'],
        where: {
          createdAt: { gte: scope.from, lt: scope.to },
          cashbox: { storeId: scope.storeId, ...warehouse },
          order: { rental: { isNot: null } },
          OR: [
            {
              type: CashTransactionType.INCOME,
              category: CashTransactionCategory.RENTAL,
            },
            {
              type: CashTransactionType.EXPENSE,
              category: CashTransactionCategory.RETURN,
            },
          ],
        },
        _sum: { amount: true },
      }),
      this.prisma.rental.findMany({
        where: {
          storeId: scope.storeId,
          ...warehouse,
          status: { in: RENTAL_OUT_STATUSES },
        },
        select: {
          endDate: true,
          order: { select: { items: { select: { quantity: true } } } },
          returns: { select: { items: { select: { quantity: true } } } },
        },
      }),
    ]);

    const sumBy = (type: CashTransactionType) =>
      money(cash.find((row) => row.type === type)?._sum.amount);
    const now = new Date();
    const today = todayLocalDate(now);
    const todayNoon = rentalBoundary(today);
    const tomorrowNoon = rentalBoundary(addLocalDays(today, 1));
    let out = 0;
    let dueToday = 0;
    let overdue = 0;
    for (const r of active) {
      const taken = r.order.items.reduce((sum, i) => sum + i.quantity, 0);
      const back = r.returns
        .flatMap((ret) => ret.items)
        .reduce((sum, i) => sum + i.quantity, 0);
      const units = Math.max(0, taken - back);
      out += units;
      if (r.endDate >= todayNoon && r.endDate < tomorrowNoon) dueToday += units;
      if (r.endDate < now) overdue += units;
    }

    return {
      income:
        sumBy(CashTransactionType.INCOME) - sumBy(CashTransactionType.EXPENSE),
      out,
      dueToday,
      overdue,
    };
  }

  /** 24 local hours: average sales per day of the period, peak and quietest hour. */
  private hours(
    scope: Scope,
    rows: { hour: number; sales: RawNumber; orders: number }[],
  ): DashboardActivity['hours'] {
    const days = Math.max(
      1,
      Math.ceil((scope.to.getTime() - scope.from.getTime()) / DAY_MS),
    );
    const byHour = new Map(rows.map((row) => [Number(row.hour), row]));
    const points = Array.from({ length: HOURS_IN_DAY }, (_, hour) => ({
      hour,
      avgSales: Math.round(num(byHour.get(hour)?.sales) / days),
      orders: byHour.get(hour)?.orders ?? 0,
    }));
    const selling = points.filter((p) => p.orders > 0);
    const peak = selling.reduce<(typeof points)[number] | null>(
      (best, p) => (!best || p.avgSales > best.avgSales ? p : best),
      null,
    );
    const quiet =
      selling.length >= 2
        ? selling.reduce((low, p) => (p.avgSales < low.avgSales ? p : low))
        : null;

    return {
      days,
      points,
      peakHour: peak?.hour ?? null,
      quietHour: quiet?.hour ?? null,
    };
  }

  private period(scope: Scope): DashboardPeriod {
    return {
      from: scope.from,
      to: scope.to,
      granularity: scope.granularity,
    };
  }

  /**
   * Owner of a store only (an admin has no store); period ≤ 31 days; the
   * warehouse must belong to the owner's store.
   */
  private async resolveScope(
    params: DashboardParams,
    user: CurrentUser,
  ): Promise<Scope> {
    const isOwner =
      user.role === UserRole.OWNER || user.staff?.role === StaffRole.OWNER;
    if (!user.staff || !isOwner) {
      throw new ForbiddenException('Store owner only');
    }
    const from = new Date(params.from);
    const to = new Date(params.to);
    const length = to.getTime() - from.getTime();
    if (!(length > 0)) {
      throw new BadRequestException('`to` must be after `from`');
    }
    if (length > MAX_PERIOD_DAYS * DAY_MS) {
      throw new BadRequestException(
        `The period must not be longer than ${MAX_PERIOD_DAYS} days`,
      );
    }
    const warehouseId = params.warehouseId ?? null;
    if (warehouseId) {
      await assertWarehouseAccess(this.prisma, user, warehouseId);
    }

    return {
      storeId: user.staff.storeId,
      warehouseId,
      from,
      to,
      granularity: length <= DAY_MS ? 'hour' : 'day',
    };
  }

  /**
   * Orders sold in the period (alias `o`): paid, on debt or later returned,
   * never rental orders. Same statuses as `SOLD_ORDER_FILTER` without rentals.
   */
  private soldOrders(scope: Scope): Prisma.Sql {
    return Prisma.sql`o."storeId" = ${scope.storeId}
      ${this.orderWarehouse(scope)}
      AND o."soldAt" >= ${this.timestamp(scope.from)}
      AND o."soldAt" < ${this.timestamp(scope.to)}
      AND o.status IN ('COMPLETED', 'DEBT', 'REFUNDED')
      AND NOT EXISTS (SELECT 1 FROM rentals r WHERE r."orderId" = o.id)`;
  }

  /** Returns made in the period (aliases `ro`, `o`), whenever the order was sold. */
  private returnsInPeriod(scope: Scope): Prisma.Sql {
    return Prisma.sql`o."storeId" = ${scope.storeId}
      ${this.orderWarehouse(scope)}
      AND ro."createdAt" >= ${this.timestamp(scope.from)}
      AND ro."createdAt" < ${this.timestamp(scope.to)}
      AND NOT EXISTS (SELECT 1 FROM rentals r WHERE r."orderId" = o.id)`;
  }

  private orderWarehouse(scope: Scope): Prisma.Sql {
    return scope.warehouseId
      ? Prisma.sql`AND o."warehouseId" = ${scope.warehouseId}`
      : Prisma.empty;
  }

  /**
   * An instant as the `timestamp(3)` (UTC, no zone) the columns store —
   * independent of the DB session time zone.
   */
  private timestamp(date: Date): Prisma.Sql {
    return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  }

  /** A UTC `timestamp(3)` column as the store's local wall time. */
  private localTime(column: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${REPORT_TIME_ZONE})`;
  }

  /** Every hour / day of the period, empty ones included, in order. */
  private chart(
    scope: Scope,
    rows: { key: string; sales: RawNumber; orders: number }[],
  ): DashboardSummary['chart'] {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const step = scope.granularity === 'hour' ? HOUR_MS : DAY_MS;
    // Bucket starts in local wall time (shifted by the fixed offset)
    const localFrom = scope.from.getTime() + REPORT_UTC_OFFSET_MS;
    const localTo = scope.to.getTime() + REPORT_UTC_OFFSET_MS;
    const points: DashboardSummary['chart'] = [];
    for (
      let local = localFrom - (localFrom % step);
      local < localTo;
      local += step
    ) {
      const iso = new Date(local).toISOString();
      const key =
        scope.granularity === 'hour'
          ? `${iso.slice(0, 10)} ${iso.slice(11, 13)}`
          : iso.slice(0, 10);
      const row = byKey.get(key);
      points.push({
        at: new Date(local - REPORT_UTC_OFFSET_MS),
        sales: money(row?.sales),
        orders: row?.orders ?? 0,
      });
    }

    return points;
  }

  private cashflow(
    rows: {
      type: CashTransactionType;
      category: CashTransactionCategory;
      _sum: { amount: Prisma.Decimal | null };
    }[],
  ): DashboardSummary['cashflow'] {
    let income = 0;
    let purchase = 0;
    const expenseBy = new Map<CashTransactionCategory, number>();
    for (const row of rows) {
      const amount = money(row._sum.amount);
      if (row.type === CashTransactionType.INCOME) {
        income += amount;
      } else if (row.category === PURCHASE_CATEGORY) {
        purchase += amount;
      } else {
        expenseBy.set(
          row.category,
          (expenseBy.get(row.category) ?? 0) + amount,
        );
      }
    }
    const expenses = [...expenseBy.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
    const expensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

    return {
      income,
      expenses,
      expensesTotal,
      purchase,
      net: income - expensesTotal - purchase,
    };
  }
}

function num(value: RawNumber | undefined): number {
  return value == null ? 0 : Number(value);
}

/** UZS has no fractions: amounts go out as whole numbers. */
function money(value: RawNumber | undefined): number {
  return Math.round(num(value));
}
