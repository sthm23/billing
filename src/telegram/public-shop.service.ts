import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import { OnlineOrderStatus } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { FileHelper } from '@shared/helper/file.helper';
import {
  CreateOnlineOrderDto,
  ShopProductsQueryDto,
} from './dto/public-shop.dto';
import {
  attributeValueText,
  formatAmount,
  normalizePhone,
} from './public-shop.helpers';
import type { ShopContext } from './shop-context';
import { TelegramBotClient } from './telegram-bot.client';
import {
  ITEMS_UNAVAILABLE,
  PUBLIC_SHOP,
  TOO_MANY_PENDING_REQUESTS,
} from './telegram.constants';
import { TokenCryptoService } from './token-crypto.service';
import { regionName, UZ_REGIONS } from './uz-regions';

interface Label {
  name: string;
  nameUz: string | null;
  nameEn: string | null;
}

export interface ShopCategory extends Label {
  id: string;
  /** Products of the category visible in the shop */
  count: number;
}

export interface ShopInfo {
  name: string;
  slug: string;
  categories: ShopCategory[];
  regions: readonly { code: string; ru: string; uz: string }[];
}

export interface ShopProductListItem {
  id: string;
  name: string;
  brand: string | null;
  category: Label | null;
  imageUrl: string | null;
  priceFrom: Prisma.Decimal | null;
  priceTo: Prisma.Decimal | null;
  /** Total over all warehouses of the store */
  quantity: number;
  inStock: boolean;
}

export interface ShopProductList {
  currentPage: number;
  pageSize: number;
  total: number;
  data: ShopProductListItem[];
}

export interface ShopVariant {
  id: string;
  price: Prisma.Decimal;
  quantity: number;
  inStock: boolean;
  attributes: {
    attributeId: string;
    name: string;
    nameUz: string | null;
    nameEn: string | null;
    unit: string | null;
    value: string | number | boolean | null;
  }[];
}

export interface ShopProduct {
  id: string;
  name: string;
  brand: string | null;
  category: Label | null;
  description: string | null;
  images: string[];
  variants: ShopVariant[];
}

export interface CreatedOnlineOrder {
  id: string;
  number: number;
  status: OnlineOrderStatus;
  /** What the customer saw, at current prices — information only */
  total: string;
  createdAt: Date;
}

const LABEL_SELECT = { name: true, nameUz: true, nameEn: true } as const;

/** Stock that counts for a customer: active warehouses of the store, all of them. */
const STOCK_SELECT = {
  where: { warehouse: { isActive: true } },
  select: { quantity: true },
} as const;

const SELLABLE_VARIANT = { canSell: true } as const;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const sumStock = (rows: { quantity: number }[]): number =>
  rows.reduce((total, row) => total + row.quantity, 0);

/**
 * What a customer of the store's Telegram shop sees and does (docs/telegram-shop/PLAN.md).
 * Every query is scoped by `shop.storeId` from the address, never by the request.
 * Nothing here touches stock or money: a request is only a draft for an employee.
 */
@Injectable()
export class PublicShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TelegramBotClient,
    private readonly crypto: TokenCryptoService,
    @InjectPinoLogger(PublicShopService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getShop(shop: ShopContext): Promise<ShopInfo> {
    const groups = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: { ...this.visible(shop.storeId), categoryId: { not: null } },
      _count: { _all: true },
    });
    const ids = groups.flatMap((g) => (g.categoryId ? [g.categoryId] : []));
    const categories = ids.length
      ? await this.prisma.category.findMany({
          where: { id: { in: ids } },
          select: { id: true, ...LABEL_SELECT },
        })
      : [];
    const counts = new Map(groups.map((g) => [g.categoryId, g._count._all]));

    return {
      name: shop.storeName,
      slug: shop.slug,
      categories: categories
        .map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      regions: UZ_REGIONS,
    };
  }

  async listProducts(
    shop: ShopContext,
    query: ShopProductsQueryDto,
  ): Promise<ShopProductList> {
    // Query numbers arrive as strings: the global pipe returns the raw query
    const pageSize = Math.min(
      Math.max(Number(query.pageSize) || PUBLIC_SHOP.DEFAULT_PAGE_SIZE, 1),
      PUBLIC_SHOP.MAX_PAGE_SIZE,
    );
    const currentPage = Math.max(Number(query.currentPage) || 1, 1);

    const and: Prisma.ProductWhereInput[] = [this.visible(shop.storeId)];
    const search = query.search?.trim();
    if (search) {
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { brand: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.categoryId) {
      // A direction includes the products of its subcategories (two levels only)
      and.push({
        OR: [
          { categoryId: query.categoryId },
          { category: { parentId: query.categoryId } },
        ],
      });
    }
    const where: Prisma.ProductWhereInput = { AND: and };

    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip: (currentPage - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          brand: { select: { name: true } },
          category: { select: LABEL_SELECT },
          images: {
            orderBy: [{ isMain: 'desc' }, { order: 'asc' }],
            take: 1,
            select: { key: true },
          },
          variants: {
            where: SELLABLE_VARIANT,
            select: { price: true, inventory: STOCK_SELECT },
          },
        },
      }),
    ]);

    return {
      currentPage,
      pageSize,
      total,
      data: rows.map((product) => {
        const prices = product.variants.map((v) => v.price);
        const quantity = product.variants.reduce(
          (sum, v) => sum + sumStock(v.inventory),
          0,
        );

        return {
          id: product.id,
          name: product.name,
          brand: product.brand?.name ?? null,
          category: product.category,
          imageUrl: product.images[0]
            ? FileHelper.toPublicUrl(product.images[0].key)
            : null,
          priceFrom: prices.length ? Prisma.Decimal.min(...prices) : null,
          priceTo: prices.length ? Prisma.Decimal.max(...prices) : null,
          quantity,
          inStock: quantity > 0,
        };
      }),
    };
  }

  async getProduct(shop: ShopContext, id: string): Promise<ShopProduct> {
    const product = await this.prisma.product.findFirst({
      where: { id, ...this.visible(shop.storeId) },
      select: {
        id: true,
        name: true,
        description: true,
        brand: { select: { name: true } },
        category: { select: LABEL_SELECT },
        images: {
          orderBy: [{ isMain: 'desc' }, { order: 'asc' }],
          select: { key: true },
        },
        variants: {
          where: SELLABLE_VARIANT,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            price: true,
            inventory: STOCK_SELECT,
            attributes: {
              select: {
                value: {
                  select: {
                    attributeId: true,
                    valueString: true,
                    valueNumber: true,
                    valueBool: true,
                    attribute: { select: { ...LABEL_SELECT, unit: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    return {
      id: product.id,
      name: product.name,
      brand: product.brand?.name ?? null,
      category: product.category,
      description: product.description,
      images: product.images.map((i) => FileHelper.toPublicUrl(i.key)),
      variants: product.variants.map((variant) => {
        const quantity = sumStock(variant.inventory);

        return {
          id: variant.id,
          price: variant.price,
          quantity,
          inStock: quantity > 0,
          attributes: variant.attributes.map(({ value }) => ({
            attributeId: value.attributeId,
            name: value.attribute.name,
            nameUz: value.attribute.nameUz,
            nameEn: value.attribute.nameEn,
            unit: value.attribute.unit,
            value:
              value.valueString ??
              (value.valueNumber !== null ? Number(value.valueNumber) : null) ??
              value.valueBool,
          })),
        };
      }),
    };
  }

  async createOrder(
    shop: ShopContext,
    dto: CreateOnlineOrderDto,
  ): Promise<CreatedOnlineOrder> {
    // The global pipe returns the raw body: the text fields are cleaned here too
    const phone = normalizePhone(dto.phone);
    const fullName = dto.fullName.trim();
    const district = dto.district.trim();
    const comment = dto.comment?.trim() || null;
    if (!phone || fullName.length < 2 || district.length < 2) {
      throw new BadRequestException('Check the name, phone and district');
    }

    const variantIds = dto.items.map((i) => i.variantId);
    if (new Set(variantIds).size !== variantIds.length) {
      throw new BadRequestException('Each product may appear once');
    }

    const pending = await this.prisma.onlineOrder.count({
      where: {
        storeId: shop.storeId,
        telegramUserId: shop.telegramUserId,
        status: OnlineOrderStatus.NEW,
      },
    });
    if (pending >= PUBLIC_SHOP.MAX_PENDING_PER_USER) {
      throw new HttpException(
        {
          code: TOO_MANY_PENDING_REQUESTS,
          message: 'You already have requests waiting for the store',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Only variants of THIS store that are for sale and not archived
    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
        storeId: shop.storeId,
        canSell: true,
        product: { isArchived: false },
      },
      select: {
        id: true,
        price: true,
        product: { select: { name: true } },
        attributes: {
          select: {
            value: {
              select: {
                valueString: true,
                valueNumber: true,
                valueBool: true,
              },
            },
          },
        },
      },
    });
    const found = new Map(variants.map((v) => [v.id, v]));
    const missing = variantIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: ITEMS_UNAVAILABLE,
        message: 'Some products are no longer available',
        variantIds: missing,
      });
    }

    const lines = dto.items.map((item) => {
      const variant = found.get(item.variantId) as NonNullable<
        ReturnType<typeof found.get>
      >;
      const quantity = Number(item.quantity);
      const options = variant.attributes
        .map((a) => attributeValueText(a.value))
        .filter(Boolean)
        .join(' ');

      return {
        variantId: item.variantId,
        quantity,
        priceAtRequest: variant.price,
        label: [variant.product.name, options].filter(Boolean).join(' '),
      };
    });
    const total = lines.reduce(
      (sum, l) => sum.plus(l.priceAtRequest.mul(l.quantity)),
      new Prisma.Decimal(0),
    );

    const created = await this.createWithNumber({
      storeId: shop.storeId,
      telegramUserId: shop.telegramUserId,
      fullName,
      phone,
      region: dto.region,
      district,
      comment,
      items: lines.map(({ variantId, quantity, priceAtRequest }) => ({
        variantId,
        quantity,
        priceAtRequest,
      })),
    });

    this.logger.info(
      {
        storeId: shop.storeId,
        onlineOrderId: created.id,
        number: created.number,
      },
      'Online order request created',
    );
    await this.notifyStore(shop, created.number, {
      fullName,
      phone,
      region: dto.region,
      district,
      comment,
      lines,
      total,
    });

    return {
      id: created.id,
      number: created.number,
      status: OnlineOrderStatus.NEW,
      total: total.toString(),
      createdAt: created.createdAt,
    };
  }

  private visible(storeId: string): Prisma.ProductWhereInput {
    return {
      storeId,
      isArchived: false,
      variants: { some: SELLABLE_VARIANT },
    };
  }

  /** Number = last + 1 in the store; if a parallel request took it, the unique index says so and we retry. */
  private async createWithNumber(data: {
    storeId: string;
    telegramUserId: string;
    fullName: string;
    phone: string;
    region: string;
    district: string;
    comment: string | null;
    items: {
      variantId: string;
      quantity: number;
      priceAtRequest: Prisma.Decimal;
    }[];
  }): Promise<{ id: string; number: number; createdAt: Date }> {
    const { items, ...fields } = data;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const last = await tx.onlineOrder.aggregate({
            where: { storeId: data.storeId },
            _max: { number: true },
          });

          return tx.onlineOrder.create({
            data: {
              ...fields,
              number: (last._max.number ?? 0) + 1,
              items: { create: items },
            },
            select: { id: true, number: true, createdAt: true },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error) && attempt < PUBLIC_SHOP.NUMBER_RETRIES) {
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Tells the store about the request through its own bot. Best effort: the request is
   * already saved, the employee also sees it in the app. Plain text (no parse mode):
   * what the customer typed cannot format or link anything.
   */
  private async notifyStore(
    shop: ShopContext,
    number: number,
    request: {
      fullName: string;
      phone: string;
      region: string;
      district: string;
      comment: string | null;
      lines: {
        label: string;
        quantity: number;
        priceAtRequest: Prisma.Decimal;
      }[];
      total: Prisma.Decimal;
    },
  ): Promise<void> {
    if (!shop.notifyChatId) {
      this.logger.info(
        { storeId: shop.storeId },
        'No notification chat for a new request',
      );

      return;
    }
    const shown = request.lines.slice(0, PUBLIC_SHOP.MAX_MESSAGE_LINES);
    const hidden = request.lines.length - shown.length;
    const text = [
      `🛒 Новая заявка №${number}`,
      request.fullName,
      `📞 ${request.phone}`,
      `📍 ${regionName(request.region)}, ${request.district}`,
      ...(request.comment ? [`💬 ${request.comment}`] : []),
      '',
      ...shown.map(
        (l) =>
          `• ${l.label} ×${l.quantity} — ${formatAmount(l.priceAtRequest.mul(l.quantity).toString())}`,
      ),
      ...(hidden > 0 ? [`… и ещё ${hidden}`] : []),
      `Итого: ${formatAmount(request.total.toString())} сум`,
      '',
      'Откройте sthm → Заявки, чтобы позвонить клиенту и подтвердить.',
    ].join('\n');

    try {
      const token = this.crypto.decrypt(shop.botTokenEnc);
      await this.client.sendMessage(token, shop.notifyChatId, text);
    } catch (error) {
      this.logger.warn(
        {
          storeId: shop.storeId,
          err: error instanceof Error ? error.message : 'unknown',
        },
        'Could not notify the store about a new request',
      );
    }
  }
}
