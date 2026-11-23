import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { UserRole } from '@generated/enums';
import type { CurrentUser } from '@auth/models/auth.model';
import { PrismaService } from '@prisma/prisma.service';
import { ATTRIBUTE_LABEL_SELECT } from '@shared/helper/attribute.helper';
import { assertWarehouseAccess } from '@shared/helper/warehouse-access.helper';
import {
  MatchOrderTextDto,
  OrderAssistantFeedbackDto,
} from './dto/order-assistant.dto';
import {
  AliasHit,
  CatalogueVariant,
  MATCH_STATUS,
  MatchLine,
  buildIndex,
  matchPhrase,
  splitPhrases,
} from './engine/matcher';
import { phraseKey } from './engine/normalize';
import {
  LEARNING_SOURCES,
  ORDER_ASSISTANT_DISABLED,
  ORDER_ASSISTANT_LIMITS,
} from './order-assistant.constants';

export interface MatchResponse {
  lines: MatchLine[];
}

export interface FeedbackResponse {
  /** Aliases created or reinforced by CHANGED / MANUAL */
  learned: number;
  /** Existing aliases confirmed by PICKED / ACCEPTED */
  reinforced: number;
}

/**
 * Order assistant (docs/voice-order/DESIGN.md): text → candidate variants of the
 * working warehouse, and alias learning from the seller's choices. Read-only
 * for orders and stock — the client adds the lines to its cart.
 */
@Injectable()
export class OrderAssistantService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(OrderAssistantService.name)
    private readonly logger: PinoLogger,
  ) {}

  async match(
    dto: MatchOrderTextDto,
    user: CurrentUser,
  ): Promise<MatchResponse> {
    await assertWarehouseAccess(this.prisma, user, dto.warehouseId);
    const startedAt = Date.now();

    const storeId = await this.assertAssistantStore(user, dto.warehouseId);
    const index = buildIndex(
      await this.loadCatalogue(storeId, dto.warehouseId),
    );
    const phrases = splitPhrases(dto.text, index);
    if (phrases.length > ORDER_ASSISTANT_LIMITS.PHRASES) {
      throw new BadRequestException(
        `Too many products in one request: ${phrases.length} (max ${ORDER_ASSISTANT_LIMITS.PHRASES})`,
      );
    }

    const aliases = await this.loadAliases(
      storeId,
      phrases.map((p) => p.key),
    );
    const lines = phrases.map((p) =>
      matchPhrase(p, index, aliases.get(p.key) ?? []),
    );

    // Quality stats only — never the seller's text
    const count = (status: string) =>
      lines.filter((l) => l.status === status).length;
    this.logger.info(
      {
        warehouseId: dto.warehouseId,
        variants: index.entries.length,
        phrases: lines.length,
        matched: count(MATCH_STATUS.MATCHED),
        ambiguous: count(MATCH_STATUS.AMBIGUOUS),
        notFound: count(MATCH_STATUS.NOT_FOUND),
        ms: Date.now() - startedAt,
      },
      'Order assistant match',
    );

    return { lines };
  }

  async feedback(
    dto: OrderAssistantFeedbackDto,
    user: CurrentUser,
  ): Promise<FeedbackResponse> {
    await assertWarehouseAccess(this.prisma, user, dto.warehouseId);
    await this.assertAssistantStore(user, dto.warehouseId);
    // A platform admin has no staff record to attribute an alias to
    if (!user.staff) return { learned: 0, reinforced: 0 };

    const storeId = user.staff.storeId;
    const variantIds = [...new Set(dto.choices.map((c) => c.variantId))];
    const sellable = await this.prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
        storeId,
        warehouseId: dto.warehouseId,
        canSell: true,
        product: { isArchived: false },
      },
      select: { id: true },
    });
    if (sellable.length !== variantIds.length) {
      throw new BadRequestException('Variant not found in this warehouse');
    }

    // One row per phrase key + variant
    const choices = new Map<
      string,
      { key: string; variantId: string; learn: boolean }
    >();
    for (const choice of dto.choices) {
      const key = phraseKey(choice.phrase);
      if (!key) continue;

      const id = `${key}|${choice.variantId}`;
      const learn =
        LEARNING_SOURCES.has(choice.source) ||
        (choices.get(id)?.learn ?? false);
      choices.set(id, { key, variantId: choice.variantId, learn });
    }

    const staffId = user.staff.id;
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      let learned = 0;
      let reinforced = 0;
      for (const { key, variantId, learn } of choices.values()) {
        if (learn) {
          await tx.voiceAlias.upsert({
            where: {
              storeId_phrase_variantId: { storeId, phrase: key, variantId },
            },
            create: { storeId, phrase: key, variantId, createdById: staffId },
            update: { hits: { increment: 1 }, lastUsedAt: now },
          });
          learned++;
          continue;
        }

        const { count } = await tx.voiceAlias.updateMany({
          where: { storeId, phrase: key, variantId },
          data: { hits: { increment: 1 }, lastUsedAt: now },
        });
        reinforced += count;
      }

      return { learned, reinforced };
    });

    this.logger.info(
      { warehouseId: dto.warehouseId, choices: dto.choices.length, ...result },
      'Order assistant feedback',
    );

    return result;
  }

  /**
   * Store of the staff (an admin: of the chosen warehouse) with the assistant
   * switched on by a platform admin (`Store.orderAssistantEnabled`); 403 otherwise.
   */
  private async assertAssistantStore(
    user: CurrentUser,
    warehouseId: string,
  ): Promise<string> {
    const store =
      user.role !== UserRole.ADMIN && user.staff
        ? await this.prisma.store.findUnique({
            where: { id: user.staff.storeId },
            select: { id: true, orderAssistantEnabled: true },
          })
        : (
            await this.prisma.warehouse.findUniqueOrThrow({
              where: { id: warehouseId },
              select: {
                store: { select: { id: true, orderAssistantEnabled: true } },
              },
            })
          ).store;
    if (!store?.orderAssistantEnabled) {
      throw new ForbiddenException({
        code: ORDER_ASSISTANT_DISABLED,
        message: 'Order assistant is not enabled for this store',
      });
    }

    return store.id;
  }

  /** Sellable variants of the warehouse (~500 per store, loaded per request: price and stock stay fresh). */
  private async loadCatalogue(
    storeId: string,
    warehouseId: string,
  ): Promise<CatalogueVariant[]> {
    const variants = await this.prisma.productVariant.findMany({
      where: {
        storeId,
        warehouseId,
        canSell: true,
        product: { isArchived: false },
      },
      select: {
        id: true,
        sku: true,
        barCode: true,
        price: true,
        product: {
          select: { id: true, name: true, brand: { select: { name: true } } },
        },
        inventory: { where: { warehouseId }, select: { quantity: true } },
        attributes: {
          select: {
            value: {
              select: {
                valueString: true,
                valueNumber: true,
                valueBool: true,
                attribute: { select: ATTRIBUTE_LABEL_SELECT },
              },
            },
          },
        },
      },
    });

    return variants.map((v) => ({
      variantId: v.id,
      productId: v.product.id,
      productName: v.product.name,
      brandName: v.product.brand?.name ?? null,
      sku: v.sku,
      barCode: v.barCode,
      price: v.price.toString(),
      stock: v.inventory.reduce((sum, i) => sum + i.quantity, 0),
      attributes: v.attributes.map(({ value }) => ({
        name: value.attribute.name,
        nameUz: value.attribute.nameUz,
        nameEn: value.attribute.nameEn,
        value:
          value.valueString ??
          value.valueNumber?.toString() ??
          (value.valueBool === null ? null : String(value.valueBool)),
      })),
    }));
  }

  private async loadAliases(
    storeId: string,
    keys: string[],
  ): Promise<Map<string, AliasHit[]>> {
    const byKey = new Map<string, AliasHit[]>();
    const unique = [...new Set(keys.filter(Boolean))];
    if (unique.length === 0) return byKey;

    const rows = await this.prisma.voiceAlias.findMany({
      where: { storeId, phrase: { in: unique } },
      select: { phrase: true, variantId: true, hits: true, lastUsedAt: true },
    });
    for (const { phrase, ...hit } of rows) {
      byKey.set(phrase, [...(byKey.get(phrase) ?? []), hit]);
    }

    return byKey;
  }
}
