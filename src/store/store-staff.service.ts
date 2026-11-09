import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import { StaffDeactivationReason, StaffRole, UserRole } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { DateRangeParams } from '@shared/dto/date-range.dto';
import { SOLD_ORDER_FILTER } from '@order/entities/sold-order.filter';
import {
  DeactivateStaffDto,
  StaffListParams,
  UpdateStaffDto,
} from './dto/staff.dto';

const STAFF_INCLUDE = {
  user: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      role: true,
      auth: { select: { login: true } },
    },
  },
  warehouse: { select: { warehouse: { select: { id: true, name: true } } } },
} satisfies Prisma.StaffInclude;

type StaffRow = Prisma.StaffGetPayload<{ include: typeof STAFF_INCLUDE }>;

export type StaffListItem = {
  /** Staff id (the resource of /store/staff/:id) */
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  login: string | null;
  role: StaffRole;
  /** The store owner: works with all warehouses, cannot be edited or deactivated here */
  isOwner: boolean;
  isActive: boolean;
  warehouses: { id: string; name: string }[];
  createdAt: Date;
};

export type StaffListResponse = {
  data: StaffListItem[];
  /** Counted over search + warehouse, before the role filter (role chips) */
  counts: {
    total: number;
    active: number;
    byRole: Partial<Record<StaffRole, number>>;
  };
};

export type StaffDetails = StaffListItem & {
  deactivatedAt: Date | null;
  deactivationReason: StaffDeactivationReason | null;
  deactivatedBy: { id: string; fullName: string } | null;
  /** Sold orders where the employee is the cashier, in [from, to) */
  stats: { from: Date; to: Date; salesTotal: number; ordersCount: number };
};

/** A store has a few dozen employees at most; the list is not paginated. */
const MAX_STAFF = 500;

/** Period of the card stats; without bounds — the current server month. */
function resolveMonthRange({ from, to }: DateRangeParams): {
  from: Date;
  to: Date;
} {
  if (from) {
    const start = new Date(from);
    const end = to ? new Date(to) : new Date();
    return { from: start, to: end };
  }
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

function isOwnerRow(row: StaffRow): boolean {
  return row.role === StaffRole.OWNER || row.user.role === UserRole.OWNER;
}

function toItem(row: StaffRow): StaffListItem {
  return {
    id: row.id,
    userId: row.userId,
    fullName: row.user.fullName,
    phone: row.user.phone,
    login: row.user.auth?.login ?? null,
    role: row.role,
    isOwner: isOwnerRow(row),
    isActive: row.isActive,
    warehouses: row.warehouse.map((w) => w.warehouse),
    createdAt: row.createdAt,
  };
}

/** Owner first, then active before deactivated, then by name. */
function compareStaff(a: StaffListItem, b: StaffListItem): number {
  if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return a.fullName.localeCompare(b.fullName, 'ru');
}

/**
 * Employees of the owner's store: list, card, edit, deactivate / restore.
 * The store always comes from the token, never from the request.
 */
@Injectable()
export class StoreStaffService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(StoreStaffService.name)
    private readonly logger: PinoLogger,
  ) {}

  async list(
    params: StaffListParams,
    user: CurrentUser,
  ): Promise<StaffListResponse> {
    const storeId = this.storeIdOf(user);
    if (params.warehouseId) {
      await this.assertWarehouses(storeId, [params.warehouseId]);
    }

    const and: Prisma.StaffWhereInput[] = [{ storeId }];
    const search = params.search?.trim();
    if (search) {
      const phone = search.replace(/[\s()-]/g, '');
      and.push({
        user: {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            ...(phone ? [{ phone: { contains: phone } }] : []),
            { auth: { login: { contains: search, mode: 'insensitive' } } },
          ],
        },
      });
    }
    if (params.warehouseId) {
      and.push({
        OR: [
          { warehouse: { some: { warehouseId: params.warehouseId } } },
          { role: StaffRole.OWNER },
        ],
      });
    }

    let rows: StaffRow[];
    try {
      rows = await this.prisma.staff.findMany({
        where: { AND: and },
        include: STAFF_INCLUDE,
        take: MAX_STAFF,
      });
    } catch (error: any) {
      this.logger.error({ storeId, err: error.message }, 'Staff list failed');
      throw new BadRequestException(error.response || error.message);
    }

    const items = rows.map(toItem).sort(compareStaff);
    const byRole: Partial<Record<StaffRole, number>> = {};
    for (const item of items) {
      byRole[item.role] = (byRole[item.role] ?? 0) + 1;
    }

    return {
      data: params.role
        ? items.filter((item) => item.role === params.role)
        : items,
      counts: {
        total: items.length,
        active: items.filter((item) => item.isActive).length,
        byRole,
      },
    };
  }

  async findOne(
    id: string,
    range: DateRangeParams,
    user: CurrentUser,
  ): Promise<StaffDetails> {
    const storeId = this.storeIdOf(user);
    const row = await this.findRow(id, storeId);
    const { from, to } = resolveMonthRange(range);

    try {
      const [sales, deactivatedBy] = await Promise.all([
        this.prisma.order.aggregate({
          where: {
            storeId,
            cashierId: row.id,
            soldAt: { gte: from, lt: to },
            ...SOLD_ORDER_FILTER,
          },
          _count: { _all: true },
          _sum: { totalAmount: true },
        }),
        row.deactivatedById
          ? this.prisma.user.findUnique({
              where: { id: row.deactivatedById },
              select: { id: true, fullName: true },
            })
          : Promise.resolve(null),
      ]);

      return {
        ...toItem(row),
        deactivatedAt: row.deactivatedAt,
        deactivationReason: row.deactivationReason,
        deactivatedBy,
        stats: {
          from,
          to,
          salesTotal: Number(sales._sum.totalAmount ?? 0),
          ordersCount: sales._count._all,
        },
      };
    } catch (error: any) {
      this.logger.error(
        { staffId: id, err: error.message },
        'Staff card failed',
      );
      throw new BadRequestException(error.response || error.message);
    }
  }

  async update(
    id: string,
    dto: UpdateStaffDto,
    user: CurrentUser,
  ): Promise<StaffListItem> {
    const storeId = this.storeIdOf(user);
    const target = await this.findRow(id, storeId);
    if (isOwnerRow(target)) {
      throw new ForbiddenException('The store owner cannot be edited here');
    }
    if (dto.role === StaffRole.OWNER) {
      throw new ForbiddenException(
        'Store owners are created by an administrator',
      );
    }
    if (dto.warehouseIds) {
      await this.assertWarehouses(storeId, dto.warehouseIds);
    }

    const fullName = dto.fullName?.trim();
    const phone = dto.phone?.trim();
    const login = dto.login?.trim();
    await this.assertPhoneAndLoginFree(target.userId, phone, login);

    try {
      await this.prisma.$transaction(async (tx) => {
        if (fullName || phone) {
          await tx.user.update({
            where: { id: target.userId },
            data: { fullName, phone },
          });
        }
        if (login) {
          await tx.authAccount.update({
            where: { userId: target.userId },
            data: { login },
          });
        }
        if (dto.role) {
          await tx.staff.update({
            where: { id: target.id },
            data: { role: dto.role },
          });
        }
        if (dto.warehouseIds) {
          await tx.staffOnWarehouse.deleteMany({
            where: { staffId: target.id },
          });
          await tx.staffOnWarehouse.createMany({
            data: dto.warehouseIds.map((warehouseId) => ({
              staffId: target.id,
              warehouseId,
            })),
          });
        }
      });
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Login or Phone is exist!');
      }
      this.logger.error(
        { staffId: id, err: error.message },
        'Staff update failed',
      );
      throw new BadRequestException(error.response || error.message);
    }

    this.logger.info(
      {
        staffId: id,
        by: user.id,
        fields: Object.keys(dto),
      },
      'Staff updated',
    );

    return toItem(await this.findRow(id, storeId));
  }

  async deactivate(
    id: string,
    dto: DeactivateStaffDto,
    user: CurrentUser,
  ): Promise<StaffDetails> {
    const storeId = this.storeIdOf(user);
    const target = await this.findRow(id, storeId);
    if (target.id === user.staff.id) {
      throw new ForbiddenException('You cannot deactivate yourself');
    }
    if (isOwnerRow(target)) {
      throw new ForbiddenException('The store owner cannot be deactivated');
    }
    if (!target.isActive) {
      throw new BadRequestException('Employee is already deactivated');
    }

    try {
      // Login closed and every session revoked: the JWT strategy rejects
      // the employee's next request, refresh tokens stop working.
      await this.prisma.$transaction(async (tx) => {
        await tx.staff.update({
          where: { id: target.id },
          data: {
            isActive: false,
            deactivatedAt: new Date(),
            deactivatedById: user.id,
            deactivationReason: dto.reason,
          },
        });
        await tx.authAccount.updateMany({
          where: { userId: target.userId },
          data: { isActive: false },
        });
        await tx.refreshSession.updateMany({
          where: { userId: target.userId, isRevoked: false },
          data: { isRevoked: true },
        });
      });
    } catch (error: any) {
      this.logger.error(
        { staffId: id, err: error.message },
        'Staff deactivation failed',
      );
      throw new BadRequestException(error.response || error.message);
    }

    this.logger.info(
      { staffId: id, by: user.id, reason: dto.reason },
      'Staff deactivated',
    );

    return this.findOne(id, {}, user);
  }

  async activate(id: string, user: CurrentUser): Promise<StaffDetails> {
    const storeId = this.storeIdOf(user);
    const target = await this.findRow(id, storeId);
    if (target.isActive) {
      throw new BadRequestException('Employee is already active');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.staff.update({
          where: { id: target.id },
          data: {
            isActive: true,
            deactivatedAt: null,
            deactivatedById: null,
            deactivationReason: null,
          },
        });
        await tx.authAccount.updateMany({
          where: { userId: target.userId },
          data: { isActive: true },
        });
      });
    } catch (error: any) {
      this.logger.error(
        { staffId: id, err: error.message },
        'Staff restore failed',
      );
      throw new BadRequestException(error.response || error.message);
    }

    this.logger.info({ staffId: id, by: user.id }, 'Staff restored');

    return this.findOne(id, {}, user);
  }

  /** The caller's store, from the token. */
  private storeIdOf(user: CurrentUser): string {
    const storeId = user.staff?.storeId;
    if (!storeId) {
      throw new ForbiddenException('Current user is not attached to a store');
    }
    return storeId;
  }

  /** An employee of this store, or 404 (a foreign store's staff is hidden). */
  private async findRow(id: string, storeId: string): Promise<StaffRow> {
    const row = await this.prisma.staff.findFirst({
      where: { id, storeId },
      include: STAFF_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Employee not found');
    }
    return row;
  }

  /** Every warehouse must belong to the store. */
  private async assertWarehouses(
    storeId: string,
    warehouseIds: string[],
  ): Promise<void> {
    const count = await this.prisma.warehouse.count({
      where: { id: { in: warehouseIds }, storeId },
    });
    if (count !== warehouseIds.length) {
      throw new BadRequestException('Warehouse does not belong to the store');
    }
  }

  /** Phone and login are unique across all users. */
  private async assertPhoneAndLoginFree(
    userId: string,
    phone: string | undefined,
    login: string | undefined,
  ): Promise<void> {
    const or: Prisma.UserWhereInput[] = [];
    if (phone) or.push({ phone });
    if (login) or.push({ auth: { login } });
    if (!or.length) return;

    const taken = await this.prisma.user.findFirst({
      where: { id: { not: userId }, OR: or },
      select: { id: true },
    });
    if (taken) {
      this.logger.warn(
        { userId },
        'Staff update rejected: login or phone taken',
      );
      throw new ConflictException('Login or Phone is exist!');
    }
  }
}
