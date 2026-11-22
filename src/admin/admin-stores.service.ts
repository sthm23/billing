import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import {
  AttributeType,
  StaffRole,
  StoreStatus,
  StoreSuspendReason,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { HashingHelper } from '@shared/helper/hash.helper';
import {
  AdminStoreListParams,
  CreateAdminStoreDto,
  ResumeStoreDto,
  SuspendStoreDto,
  UpdateAdminStoreDto,
} from './dto/admin-store.dto';

/** Free trial of a new store */
export const TRIAL_MONTHS = 1;
const DEFAULT_PAGE_SIZE = 10;
/** Employees shown on the store card; the rest — «Все сотрудники» */
const STAFF_PREVIEW = 5;

const OWNER_STAFF_WHERE = {
  role: StaffRole.OWNER,
} satisfies Prisma.StaffWhereInput;

const OWNER_USER_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  auth: { select: { login: true, isActive: true } },
} satisfies Prisma.UserSelect;

const LIST_INCLUDE = {
  staff: {
    where: OWNER_STAFF_WHERE,
    take: 1,
    select: { isActive: true, user: { select: OWNER_USER_SELECT } },
  },
  _count: { select: { warehouse: true, staff: true } },
} satisfies Prisma.StoreInclude;

type ListRow = Prisma.StoreGetPayload<{ include: typeof LIST_INCLUDE }>;

const STAFF_SELECT = {
  id: true,
  role: true,
  isActive: true,
  user: { select: { id: true, fullName: true, phone: true, role: true } },
  warehouse: { select: { warehouse: { select: { id: true, name: true } } } },
} satisfies Prisma.StaffSelect;

type StaffRow = Prisma.StaffGetPayload<{ select: typeof STAFF_SELECT }>;

export type AdminStoreOwner = {
  id: string;
  fullName: string;
  phone: string;
  login: string | null;
  isActive: boolean;
};

export type AdminStoreListItem = {
  id: string;
  name: string;
  status: StoreStatus;
  /** TRIAL whose trialEndsAt has passed (the store is not suspended automatically) */
  trialExpired: boolean;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  suspendedAt: Date | null;
  createdAt: Date;
  salesEnabled: boolean;
  rentalEnabled: boolean;
  owner: AdminStoreOwner | null;
  warehousesCount: number;
  staffCount: number;
};

export type AdminStoreCounts = {
  total: number;
  active: number;
  trial: number;
  suspended: number;
};

export type AdminStoreListResponse = {
  currentPage: number;
  pageSize: number;
  /** Matches of the current filters */
  total: number;
  data: AdminStoreListItem[];
  /** Status counts over search + mode (before the status filter) */
  counts: AdminStoreCounts;
};

export type AdminStoreStaffItem = {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  role: StaffRole;
  isOwner: boolean;
  isActive: boolean;
  warehouses: { id: string; name: string }[];
};

export type AdminStoreDetails = AdminStoreListItem & {
  address: string | null;
  inn: string | null;
  note: string | null;
  suspendReason: StoreSuspendReason | null;
  suspendComment: string | null;
  suspendedBy: { id: string; fullName: string } | null;
  activeStaffCount: number;
  warehouses: {
    id: string;
    name: string;
    isActive: boolean;
    staffCount: number;
  }[];
  /** Owner first, then active, then by name; at most STAFF_PREVIEW */
  staff: AdminStoreStaffItem[];
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  attributes: {
    id: string;
    name: string;
    type: AttributeType;
    unit: string | null;
  }[];
};

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);

  return d;
}

export function isTrialExpired(
  store: { status: StoreStatus; trialEndsAt: Date | null },
  now: Date = new Date(),
): boolean {
  return (
    store.status === StoreStatus.TRIAL &&
    !!store.trialEndsAt &&
    store.trialEndsAt.getTime() < now.getTime()
  );
}

function toOwner(
  row: ListRow['staff'][number] | undefined,
): AdminStoreOwner | null {
  if (!row) return null;

  return {
    id: row.user.id,
    fullName: row.user.fullName,
    phone: row.user.phone,
    login: row.user.auth?.login ?? null,
    isActive: row.isActive && row.user.auth?.isActive !== false,
  };
}

function toListItem(row: ListRow, now: Date): AdminStoreListItem {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    trialExpired: isTrialExpired(row, now),
    trialEndsAt: row.trialEndsAt,
    paidUntil: row.paidUntil,
    suspendedAt: row.suspendedAt,
    createdAt: row.createdAt,
    salesEnabled: row.salesEnabled,
    rentalEnabled: row.rentalEnabled,
    owner: toOwner(row.staff[0]),
    warehousesCount: row._count.warehouse,
    staffCount: row._count.staff,
  };
}

function toStaffItem(row: StaffRow): AdminStoreStaffItem {
  return {
    id: row.id,
    userId: row.user.id,
    fullName: row.user.fullName,
    phone: row.user.phone,
    role: row.role,
    isOwner: row.role === StaffRole.OWNER || row.user.role === UserRole.OWNER,
    isActive: row.isActive,
    warehouses: row.warehouse.map((w) => w.warehouse),
  };
}

function compareStaff(a: AdminStoreStaffItem, b: AdminStoreStaffItem): number {
  if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;

  return a.fullName.localeCompare(b.fullName, 'ru');
}

/** Unique names, case-insensitive, first spelling wins */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name && !seen.has(name.toLowerCase()))
      seen.set(name.toLowerCase(), name);
  }

  return [...seen.values()];
}

/**
 * Platform administration of stores (ADMIN only): list, card, create with
 * a new owner, rename / modes, suspend and resume (subscription).
 */
@Injectable()
export class AdminStoresService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AdminStoresService.name)
    private readonly logger: PinoLogger,
  ) {}

  async list(params: AdminStoreListParams): Promise<AdminStoreListResponse> {
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const currentPage = params.currentPage ?? 1;
    const base = this.listWhere(params);
    const where: Prisma.StoreWhereInput = params.status
      ? { AND: [base, { status: params.status }] }
      : base;

    const [rows, total, byStatus] = await Promise.all([
      this.prisma.store.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (currentPage - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.store.count({ where }),
      this.prisma.store.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      }),
    ]);

    const n = (s: StoreStatus) =>
      byStatus.find((g) => g.status === s)?._count._all ?? 0;
    const now = new Date();

    return {
      currentPage,
      pageSize,
      total,
      data: rows.map((r) => toListItem(r, now)),
      counts: {
        total: byStatus.reduce((sum, g) => sum + g._count._all, 0),
        active: n(StoreStatus.ACTIVE),
        trial: n(StoreStatus.TRIAL),
        suspended: n(StoreStatus.SUSPENDED),
      },
    };
  }

  async findOne(id: string): Promise<AdminStoreDetails> {
    const store = await this.prisma.store.findUnique({
      where: { id },
      include: {
        ...LIST_INCLUDE,
        warehouse: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            isActive: true,
            _count: { select: { staffs: true } },
          },
        },
        categories: {
          select: { category: { select: { id: true, name: true } } },
        },
        brands: { select: { brand: { select: { id: true, name: true } } } },
        attributes: {
          select: {
            attribute: {
              select: { id: true, name: true, type: true, unit: true },
            },
          },
        },
      },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const [staff, activeStaffCount, suspendedBy] = await Promise.all([
      this.staffOf(id),
      this.prisma.staff.count({ where: { storeId: id, isActive: true } }),
      store.suspendedById
        ? this.prisma.user.findUnique({
            where: { id: store.suspendedById },
            select: { id: true, fullName: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      ...toListItem(store, new Date()),
      address: store.address,
      inn: store.inn,
      note: store.note,
      suspendReason: store.suspendReason,
      suspendComment: store.suspendComment,
      suspendedBy,
      activeStaffCount,
      warehouses: store.warehouse.map((w) => ({
        id: w.id,
        name: w.name,
        isActive: w.isActive,
        staffCount: w._count.staffs,
      })),
      staff: staff.slice(0, STAFF_PREVIEW),
      categories: store.categories.map((c) => c.category),
      brands: store.brands
        .map((b) => b.brand)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      attributes: store.attributes.map((a) => a.attribute),
    };
  }

  /** All employees of the store, read-only for the admin */
  async listStaff(id: string): Promise<AdminStoreStaffItem[]> {
    await this.assertStore(id);

    return this.staffOf(id);
  }

  async create(
    dto: CreateAdminStoreDto,
    admin: CurrentUser,
  ): Promise<AdminStoreDetails> {
    if (!dto.salesEnabled && !dto.rentalEnabled) {
      throw new BadRequestException(
        'A store must have sales or rental enabled',
      );
    }

    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      select: { id: true, parentId: true },
    });
    if (!category || category.parentId !== null) {
      throw new BadRequestException('Category must be a top-level category');
    }

    const attributeIds = dto.attributeIds ?? [];
    if (attributeIds.length) {
      const found = await this.prisma.attribute.count({
        where: { id: { in: attributeIds } },
      });
      if (found !== attributeIds.length) {
        throw new BadRequestException('Attribute not found');
      }
    }

    const taken = await this.prisma.user.findFirst({
      where: {
        OR: [{ phone: dto.owner.phone }, { auth: { login: dto.owner.login } }],
      },
      select: { id: true },
    });
    if (taken) {
      this.logger.warn(
        { login: dto.owner.login },
        'Store creation rejected: login or phone already exists',
      );
      throw new ConflictException('Login or phone is already taken');
    }

    const passwordHash = await HashingHelper.hash(dto.owner.password, 10);
    const now = new Date();

    let storeId: string;
    try {
      storeId = await this.prisma.$transaction(async (tx) => {
        const owner = await tx.user.create({
          data: {
            fullName: dto.owner.fullName,
            phone: dto.owner.phone,
            role: UserRole.OWNER,
            type: UserType.STAFF,
            auth: { create: { login: dto.owner.login, passwordHash } },
          },
          select: { id: true },
        });

        const brandIds = await this.upsertBrands(tx, dto.brandNames ?? []);
        const newAttributeIds = await this.upsertAttributes(
          tx,
          dto.newAttributes ?? [],
        );
        const allAttributeIds = [
          ...new Set([...attributeIds, ...newAttributeIds]),
        ];

        const store = await tx.store.create({
          data: {
            name: dto.name,
            ownerId: owner.id,
            createdBy: admin.id,
            status: StoreStatus.TRIAL,
            trialEndsAt: addMonths(now, TRIAL_MONTHS),
            salesEnabled: dto.salesEnabled,
            rentalEnabled: dto.rentalEnabled,
            address: dto.address ?? null,
            inn: dto.inn ?? null,
            note: dto.note ?? null,
            categories: { create: { categoryId: category.id } },
            brands: {
              createMany: { data: brandIds.map((brandId) => ({ brandId })) },
            },
            attributes: {
              createMany: {
                data: allAttributeIds.map((attributeId) => ({ attributeId })),
              },
            },
          },
          select: { id: true },
        });

        const warehouse = await tx.warehouse.create({
          data: { name: dto.warehouseName, storeId: store.id },
          select: { id: true },
        });

        await tx.staff.create({
          data: {
            userId: owner.id,
            storeId: store.id,
            role: StaffRole.OWNER,
            warehouse: { create: { warehouseId: warehouse.id } },
          },
        });

        return store.id;
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Login or phone is already taken');
      }
      this.logger.error(
        { login: dto.owner.login, err: (error as Error).message },
        'Failed to create store',
      );
      throw error;
    }

    this.logger.info(
      { storeId, adminId: admin.id, login: dto.owner.login },
      'Store created by admin',
    );

    return this.findOne(storeId);
  }

  async update(
    id: string,
    dto: UpdateAdminStoreDto,
  ): Promise<AdminStoreDetails> {
    const store = await this.assertStore(id);
    const salesEnabled = dto.salesEnabled ?? store.salesEnabled;
    const rentalEnabled = dto.rentalEnabled ?? store.rentalEnabled;
    if (!salesEnabled && !rentalEnabled) {
      throw new BadRequestException(
        'A store must have sales or rental enabled',
      );
    }

    await this.prisma.store.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        salesEnabled,
        rentalEnabled,
      },
    });
    this.logger.info({ storeId: id, dto }, 'Store updated by admin');

    return this.findOne(id);
  }

  async suspend(
    id: string,
    dto: SuspendStoreDto,
    admin: CurrentUser,
  ): Promise<AdminStoreDetails> {
    const store = await this.assertStore(id);
    if (store.status === StoreStatus.SUSPENDED) {
      throw new BadRequestException('Store is already suspended');
    }

    await this.prisma.store.update({
      where: { id },
      data: {
        status: StoreStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedById: admin.id,
        suspendReason: dto.reason,
        suspendComment: dto.comment ?? null,
      },
    });
    this.logger.info(
      { storeId: id, adminId: admin.id, reason: dto.reason },
      'Store suspended',
    );

    return this.findOne(id);
  }

  /**
   * With `paidUntil` the store becomes ACTIVE (paid). Without it: back to
   * TRIAL while the trial lasts, otherwise ACTIVE with the old paidUntil.
   */
  async resume(
    id: string,
    dto: ResumeStoreDto,
    admin: CurrentUser,
  ): Promise<AdminStoreDetails> {
    const store = await this.assertStore(id);
    if (store.status !== StoreStatus.SUSPENDED) {
      throw new BadRequestException('Store is not suspended');
    }

    const now = new Date();
    const paidUntil = dto.paidUntil ? new Date(dto.paidUntil) : null;
    if (paidUntil && paidUntil.getTime() <= now.getTime()) {
      throw new BadRequestException('paidUntil must be in the future');
    }
    const trialLasts =
      !!store.trialEndsAt && store.trialEndsAt.getTime() > now.getTime();
    const status =
      paidUntil || !trialLasts ? StoreStatus.ACTIVE : StoreStatus.TRIAL;

    await this.prisma.store.update({
      where: { id },
      data: {
        status,
        ...(paidUntil ? { paidUntil } : {}),
        suspendedAt: null,
        suspendedById: null,
        suspendReason: null,
        suspendComment: null,
      },
    });
    this.logger.info(
      { storeId: id, adminId: admin.id, status },
      'Store resumed',
    );

    return this.findOne(id);
  }

  private listWhere(params: AdminStoreListParams): Prisma.StoreWhereInput {
    const and: Prisma.StoreWhereInput[] = [];
    const search = params.search?.trim();
    if (search) {
      const phone = search.replace(/[\s()-]/g, '');
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          {
            staff: {
              some: {
                ...OWNER_STAFF_WHERE,
                user: {
                  OR: [
                    { fullName: { contains: search, mode: 'insensitive' } },
                    ...(phone ? [{ phone: { contains: phone } }] : []),
                  ],
                },
              },
            },
          },
        ],
      });
    }
    if (params.mode === 'sale') and.push({ salesEnabled: true });
    if (params.mode === 'rent') and.push({ rentalEnabled: true });

    return and.length ? { AND: and } : {};
  }

  private async staffOf(storeId: string): Promise<AdminStoreStaffItem[]> {
    const rows = await this.prisma.staff.findMany({
      where: { storeId },
      select: STAFF_SELECT,
    });

    return rows.map(toStaffItem).sort(compareStaff);
  }

  private async assertStore(id: string) {
    const store = await this.prisma.store.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        trialEndsAt: true,
        salesEnabled: true,
        rentalEnabled: true,
      },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return store;
  }

  /** Brands are global: an existing name (any case) is reused */
  private async upsertBrands(
    tx: Prisma.TransactionClient,
    names: string[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const name of uniqueNames(names)) {
      const existing = await tx.brand.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      const brand =
        existing ??
        (await tx.brand.create({ data: { name }, select: { id: true } }));
      ids.push(brand.id);
    }

    return ids;
  }

  /** Attributes are global: an existing name is reused if its type matches */
  private async upsertAttributes(
    tx: Prisma.TransactionClient,
    attrs: { name: string; type: AttributeType; unit?: string }[],
  ): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const attr of attrs) {
      const key = attr.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = await tx.attribute.findFirst({
        where: { name: { equals: attr.name, mode: 'insensitive' } },
        select: { id: true, type: true },
      });
      if (existing) {
        if (existing.type !== attr.type) {
          throw new BadRequestException(
            `Attribute "${attr.name}" already exists with type ${existing.type}`,
          );
        }
        ids.push(existing.id);
        continue;
      }
      const created = await tx.attribute.create({
        data: {
          name: attr.name,
          type: attr.type,
          unit: attr.type === AttributeType.NUMBER ? (attr.unit ?? null) : null,
        },
        select: { id: true },
      });
      ids.push(created.id);
    }

    return ids;
  }
}
