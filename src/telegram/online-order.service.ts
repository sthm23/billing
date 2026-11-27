import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { CurrentUser } from '@auth/models/auth.model';
import { Prisma } from '@generated/client';
import { OnlineOrderStatus, OrderChannel } from '@generated/enums';
import {
  CreateOrderDto,
  CreateOrderItemDto,
} from '@order/dto/create-order.dto';
import { OrderService } from '@order/order.service';
import { PrismaService } from '@prisma/prisma.service';
import { FileHelper } from '@shared/helper/file.helper';
import { staffWarehouseIds } from '@shared/helper/role.helper';
import { assertWarehouseAccess } from '@shared/helper/warehouse-access.helper';
import { UserService } from '@user/user.service';
import {
  ConfirmOnlineOrderDto,
  OnlineOrderListParams,
  RejectOnlineOrderDto,
} from './dto/online-order.dto';
import { variantLabel } from './public-shop.helpers';
import { TelegramBotClient } from './telegram-bot.client';
import {
  CUSTOMER_TEXTS,
  INSUFFICIENT_STOCK,
  ITEMS_UNAVAILABLE,
  ONLINE_ORDER_ALREADY_HANDLED,
  ONLINE_ORDERS,
} from './telegram.constants';
import { TokenCryptoService } from './token-crypto.service';
import { regionName } from './uz-regions';

export interface OnlineOrderListItem {
  id: string;
  number: number;
  status: OnlineOrderStatus;
  fullName: string;
  phone: string;
  /** Region code and its name (the district is free text) */
  region: string;
  regionName: string;
  district: string;
  comment: string | null;
  createdAt: Date;
  handledAt: Date | null;
  /** The sale order created on confirmation */
  orderId: string | null;
  /** Number of lines */
  itemsCount: number;
  /** At the prices the customer saw — information only */
  total: string;
}

export interface OnlineOrderList {
  currentPage: number;
  pageSize: number;
  total: number;
  /** All statuses of the store (the badge of new requests) */
  counts: Record<OnlineOrderStatus, number>;
  data: OnlineOrderListItem[];
}

export interface StockShortage {
  variantId: string;
  label: string;
  requested: number;
  available: number;
}

export interface OnlineOrderItemView {
  variantId: string;
  label: string;
  quantity: number;
  priceAtRequest: string;
  currentPrice: string;
  imageUrl: string | null;
  /** Still for sale (not archived, sale not switched off) */
  available: boolean;
}

export interface WarehouseAvailability {
  id: string;
  name: string;
  /** Holds every line in the requested quantity */
  enough: boolean;
  shortages: StockShortage[];
}

export interface OnlineOrderDetails extends OnlineOrderListItem {
  telegramUserId: string;
  rejectReason: string | null;
  handledBy: string | null;
  /** NEW: the customer already in the system with this phone; later: the linked customer */
  customer: { id: string; fullName: string } | null;
  items: OnlineOrderItemView[];
  currentTotal: string;
  /** NEW only: the employee's warehouses and whether each can fill the request */
  warehouses: WarehouseAvailability[];
}

export interface ConfirmedOnlineOrder {
  orderId: string;
  customerId: string;
  customerCreated: boolean;
  /** false: the customer could not be written to (blocked the bot, never started it) — call them */
  customerNotified: boolean;
}

const STATUSES = Object.values(OnlineOrderStatus);

const VARIANT_ATTRIBUTES = {
  select: {
    value: {
      select: { valueString: true, valueNumber: true, valueBool: true },
    },
  },
} as const;

/** What is missing at a warehouse for the requested lines (stock: variantId → quantity there). */
export function findShortages(
  lines: { variantId: string; label: string; quantity: number }[],
  stock: Map<string, number>,
): StockShortage[] {
  return lines.flatMap((line) => {
    const available = stock.get(line.variantId) ?? 0;

    return available < line.quantity
      ? [
          {
            variantId: line.variantId,
            label: line.label,
            requested: line.quantity,
            available,
          },
        ]
      : [];
  });
}

const sumPrices = (
  rows: { quantity: number; price: Prisma.Decimal }[],
): Prisma.Decimal =>
  rows.reduce(
    (sum, r) => sum.plus(r.price.mul(r.quantity)),
    new Prisma.Decimal(0),
  );

/**
 * Requests from the Telegram shop as the store's employees handle them (docs/telegram-shop/PLAN.md,
 * stage 4). A request is a draft: confirming it creates a normal sale order in HOLD (channel ONLINE)
 * through the existing `OrderService`, so every sale rule (stock, prices, who may edit) stays in one
 * place. Everything is scoped by the store of the signed-in employee.
 */
@Injectable()
export class OnlineOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly users: UserService,
    private readonly client: TelegramBotClient,
    private readonly crypto: TokenCryptoService,
    @InjectPinoLogger(OnlineOrderService.name)
    private readonly logger: PinoLogger,
  ) {}

  async list(
    params: OnlineOrderListParams,
    user: CurrentUser,
  ): Promise<OnlineOrderList> {
    const storeId = this.storeId(user);
    // Query numbers arrive as strings: the global pipe returns the raw query
    const pageSize = Math.min(
      Math.max(Number(params.pageSize) || ONLINE_ORDERS.DEFAULT_PAGE_SIZE, 1),
      ONLINE_ORDERS.MAX_PAGE_SIZE,
    );
    const currentPage = Math.max(Number(params.currentPage) || 1, 1);
    const where: Prisma.OnlineOrderWhereInput = {
      storeId,
      ...(params.status ? { status: params.status } : {}),
    };

    const [total, rows, groups] = await Promise.all([
      this.prisma.onlineOrder.count({ where }),
      this.prisma.onlineOrder.findMany({
        where,
        skip: (currentPage - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: {
          items: { select: { quantity: true, priceAtRequest: true } },
        },
      }),
      this.prisma.onlineOrder.groupBy({
        by: ['status'],
        where: { storeId },
        _count: { _all: true },
      }),
    ]);

    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
      OnlineOrderStatus,
      number
    >;
    for (const g of groups) counts[g.status] = g._count._all;

    return {
      currentPage,
      pageSize,
      total,
      counts,
      data: rows.map((row) => this.toListItem(row)),
    };
  }

  async findOne(id: string, user: CurrentUser): Promise<OnlineOrderDetails> {
    const storeId = this.storeId(user);
    const request = await this.prisma.onlineOrder.findFirst({
      where: { id, storeId },
      include: {
        items: {
          select: {
            variantId: true,
            quantity: true,
            priceAtRequest: true,
            variant: {
              select: {
                price: true,
                canSell: true,
                attributes: VARIANT_ATTRIBUTES,
                product: {
                  select: {
                    name: true,
                    isArchived: true,
                    images: {
                      orderBy: [{ isMain: 'desc' }, { order: 'asc' }],
                      take: 1,
                      select: { key: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('Request not found');

    const items = request.items.map((item) => ({
      variantId: item.variantId,
      label: variantLabel(item.variant.product.name, item.variant.attributes),
      quantity: item.quantity,
      priceAtRequest: item.priceAtRequest,
      currentPrice: item.variant.price,
      imageUrl: item.variant.product.images[0]
        ? FileHelper.toPublicUrl(item.variant.product.images[0].key)
        : null,
      available: item.variant.canSell && !item.variant.product.isArchived,
    }));

    const isNew = request.status === OnlineOrderStatus.NEW;
    const [customer, handledBy, warehouses] = await Promise.all([
      this.findCustomer(request),
      this.findStaffName(request.handledById),
      isNew ? this.availability(user, storeId, items) : Promise.resolve([]),
    ]);

    return {
      ...this.toListItem(request),
      telegramUserId: request.telegramUserId,
      rejectReason: request.rejectReason,
      handledBy,
      customer,
      items: items.map((i) => ({
        variantId: i.variantId,
        label: i.label,
        quantity: i.quantity,
        priceAtRequest: i.priceAtRequest.toString(),
        currentPrice: i.currentPrice.toString(),
        imageUrl: i.imageUrl,
        available: i.available,
      })),
      currentTotal: sumPrices(
        items.map((i) => ({ quantity: i.quantity, price: i.currentPrice })),
      ).toString(),
      warehouses,
    };
  }

  async confirm(
    id: string,
    dto: ConfirmOnlineOrderDto,
    user: CurrentUser,
  ): Promise<ConfirmedOnlineOrder> {
    const storeId = this.storeId(user);
    // 403 before anything else; the order flow checks it again
    await assertWarehouseAccess(this.prisma, user, dto.warehouseId);

    const request = await this.prisma.onlineOrder.findFirst({
      where: { id, storeId },
      include: {
        items: {
          select: {
            variantId: true,
            quantity: true,
            variant: {
              select: {
                storeId: true,
                price: true,
                canSell: true,
                attributes: VARIANT_ATTRIBUTES,
                product: { select: { name: true, isArchived: true } },
              },
            },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== OnlineOrderStatus.NEW) this.alreadyHandled();

    const lines = request.items.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      price: item.variant.price,
      label: variantLabel(item.variant.product.name, item.variant.attributes),
      sellable:
        item.variant.storeId === storeId &&
        item.variant.canSell &&
        !item.variant.product.isArchived,
    }));
    const gone = lines.filter((l) => !l.sellable);
    if (gone.length > 0) {
      throw new BadRequestException({
        code: ITEMS_UNAVAILABLE,
        message: 'Some products are no longer for sale',
        lines: gone.map((l) => ({ variantId: l.variantId, label: l.label })),
      });
    }

    // The sale flow refuses lines above the stock of the order's warehouse: say what is missing
    const stock = await this.stockAt(dto.warehouseId, lines);
    const shortages = findShortages(lines, stock);
    if (shortages.length > 0) {
      throw new BadRequestException({
        code: INSUFFICIENT_STOCK,
        message: 'The warehouse does not hold all the goods of this request',
        lines: shortages,
      });
    }

    const { customerId, created } = await this.users.ensureStoreCustomer({
      fullName: request.fullName,
      phone: request.phone,
      storeId,
    });

    // Take the request first: two employees pressing «Подтвердить» create one order
    const claimed = await this.prisma.onlineOrder.updateMany({
      where: { id, storeId, status: OnlineOrderStatus.NEW },
      data: {
        status: OnlineOrderStatus.CONFIRMED,
        handledById: user.staff.id,
        handledAt: new Date(),
        customerId,
      },
    });
    if (claimed.count !== 1) this.alreadyHandled();

    let orderId: string | undefined;
    try {
      const order = await this.orders.create(
        Object.assign(new CreateOrderDto(), {
          storeId,
          warehouseId: dto.warehouseId,
          customerId,
          channel: OrderChannel.ONLINE,
        }),
        user,
      );
      orderId = order.id;
      // Current prices, no discount: the employee gives one in the order screen
      await this.orders.createOrderItems(
        Object.assign(new CreateOrderItemDto(), {
          orderId,
          customerId,
          additionalServices: [],
          items: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            retailPrice: Number(l.price),
            sale: 0,
          })),
        }),
        user,
      );
      await this.prisma.onlineOrder.update({
        where: { id },
        data: { orderId },
      });
    } catch (error) {
      await this.undoConfirm(id, orderId);
      throw error;
    }

    this.logger.info(
      { storeId, onlineOrderId: id, orderId, staffId: user.staff.id },
      'Online order request confirmed',
    );
    const customerNotified = await this.notifyCustomer(
      storeId,
      request.telegramUserId,
      (storeName) => CUSTOMER_TEXTS.confirmed(request.number, storeName),
    );

    return {
      orderId,
      customerId,
      customerCreated: created,
      customerNotified,
    };
  }

  async reject(
    id: string,
    dto: RejectOnlineOrderDto,
    user: CurrentUser,
  ): Promise<{ customerNotified: boolean }> {
    const storeId = this.storeId(user);
    // The global pipe returns the raw body: clean the text here
    const reason = dto.reason?.trim() || null;
    const request = await this.prisma.onlineOrder.findFirst({
      where: { id, storeId },
      select: { number: true, telegramUserId: true, status: true },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== OnlineOrderStatus.NEW) this.alreadyHandled();

    const claimed = await this.prisma.onlineOrder.updateMany({
      where: { id, storeId, status: OnlineOrderStatus.NEW },
      data: {
        status: OnlineOrderStatus.REJECTED,
        handledById: user.staff.id,
        handledAt: new Date(),
        rejectReason: reason,
      },
    });
    if (claimed.count !== 1) this.alreadyHandled();

    this.logger.info(
      { storeId, onlineOrderId: id, staffId: user.staff.id },
      'Online order request rejected',
    );

    return {
      customerNotified: await this.notifyCustomer(
        storeId,
        request.telegramUserId,
        () => CUSTOMER_TEXTS.rejected(request.number, reason),
      ),
    };
  }

  private storeId(user: CurrentUser): string {
    if (!user.staff) throw new ForbiddenException('Staff only');

    return user.staff.storeId;
  }

  private alreadyHandled(): never {
    throw new ConflictException({
      code: ONLINE_ORDER_ALREADY_HANDLED,
      message: 'This request was already handled',
    });
  }

  private toListItem(row: {
    id: string;
    number: number;
    status: OnlineOrderStatus;
    fullName: string;
    phone: string;
    region: string;
    district: string;
    comment: string | null;
    createdAt: Date;
    handledAt: Date | null;
    orderId: string | null;
    items: { quantity: number; priceAtRequest: Prisma.Decimal }[];
  }): OnlineOrderListItem {
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      fullName: row.fullName,
      phone: row.phone,
      region: row.region,
      regionName: regionName(row.region),
      district: row.district,
      comment: row.comment,
      createdAt: row.createdAt,
      handledAt: row.handledAt,
      orderId: row.orderId,
      itemsCount: row.items.length,
      total: sumPrices(
        row.items.map((i) => ({
          quantity: i.quantity,
          price: i.priceAtRequest,
        })),
      ).toString(),
    };
  }

  /** NEW: whoever already has this phone; later: the customer the request was linked to. */
  private async findCustomer(request: {
    status: OnlineOrderStatus;
    phone: string;
    customerId: string | null;
  }): Promise<{ id: string; fullName: string } | null> {
    if (request.status === OnlineOrderStatus.NEW) {
      const user = await this.prisma.user.findUnique({
        where: { phone: request.phone },
        select: { fullName: true, customer: { select: { id: true } } },
      });

      return user?.customer
        ? { id: user.customer.id, fullName: user.fullName }
        : null;
    }
    if (!request.customerId) return null;
    const customer = await this.prisma.customer.findUnique({
      where: { id: request.customerId },
      select: { id: true, user: { select: { fullName: true } } },
    });

    return customer
      ? { id: customer.id, fullName: customer.user.fullName }
      : null;
  }

  private async findStaffName(staffId: string | null): Promise<string | null> {
    if (!staffId) return null;
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { user: { select: { fullName: true } } },
    });

    return staff?.user.fullName ?? null;
  }

  /** Each of the employee's warehouses (the owner: all active ones) against the requested lines. */
  private async availability(
    user: CurrentUser,
    storeId: string,
    lines: { variantId: string; label: string; quantity: number }[],
  ): Promise<WarehouseAvailability[]> {
    const scope = staffWarehouseIds(user);
    const warehouses = await this.prisma.warehouse.findMany({
      where: {
        storeId,
        isActive: true,
        ...(scope ? { id: { in: scope } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (warehouses.length === 0) return [];

    const rows = await this.prisma.inventory.findMany({
      where: {
        warehouseId: { in: warehouses.map((w) => w.id) },
        variantId: { in: lines.map((l) => l.variantId) },
      },
      select: { warehouseId: true, variantId: true, quantity: true },
    });

    return warehouses.map((warehouse) => {
      const stock = new Map(
        rows
          .filter((r) => r.warehouseId === warehouse.id)
          .map((r) => [r.variantId, r.quantity]),
      );
      const shortages = findShortages(lines, stock);

      return {
        id: warehouse.id,
        name: warehouse.name,
        enough: shortages.length === 0,
        shortages,
      };
    });
  }

  private async stockAt(
    warehouseId: string,
    lines: { variantId: string }[],
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.inventory.findMany({
      where: {
        warehouseId,
        variantId: { in: lines.map((l) => l.variantId) },
      },
      select: { variantId: true, quantity: true },
    });

    return new Map(rows.map((r) => [r.variantId, r.quantity]));
  }

  /**
   * The order flow failed after the request was taken: remove the empty order it may have
   * left and give the request back, so the employee can try again. Best effort, logged.
   */
  private async undoConfirm(id: string, orderId: string | undefined) {
    try {
      if (orderId) {
        await this.prisma.$transaction([
          this.prisma.orderItem.deleteMany({ where: { orderId } }),
          this.prisma.additionalService.deleteMany({ where: { orderId } }),
          this.prisma.order.delete({ where: { id: orderId } }),
        ]);
      }
    } catch (error) {
      this.logger.error(
        { onlineOrderId: id, orderId, err: (error as Error).message },
        'Could not remove the order left by a failed confirmation',
      );
    }
    try {
      await this.prisma.onlineOrder.updateMany({
        where: { id, status: OnlineOrderStatus.CONFIRMED, orderId: null },
        data: {
          status: OnlineOrderStatus.NEW,
          handledById: null,
          handledAt: null,
          customerId: null,
        },
      });
    } catch (error) {
      this.logger.error(
        { onlineOrderId: id, err: (error as Error).message },
        'Could not give the request back after a failed confirmation',
      );
    }
  }

  /** Tells the customer through the shop's bot. false: no bot, or Telegram refused (never started / blocked it). */
  private async notifyCustomer(
    storeId: string,
    telegramUserId: string,
    text: (storeName: string) => string,
  ): Promise<boolean> {
    try {
      const bot = await this.prisma.storeTelegramBot.findUnique({
        where: { storeId },
        select: {
          botTokenEnc: true,
          store: { select: { name: true } },
        },
      });
      if (!bot) return false;
      await this.client.sendMessage(
        this.crypto.decrypt(bot.botTokenEnc),
        telegramUserId,
        text(bot.store.name),
      );

      return true;
    } catch (error) {
      this.logger.warn(
        {
          storeId,
          err: error instanceof Error ? error.message : 'unknown',
        },
        'Could not notify the customer of a request',
      );

      return false;
    }
  }
}
