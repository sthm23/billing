import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  InventoryMovementDto,
  CreateWarehouseDto,
  CreateWarehouseStaffDto,
} from './dto/create-warehouse.dto';
import { PrismaService } from '@prisma/prisma.service';
import {
  StaffRole,
  StockMovementReason,
  StockMovementType,
  UserRole,
  UserType,
} from '@generated/enums';
import { HashingHelper } from '@shared/helper/hash.helper';
import { Prisma, Staff, User } from '@generated/client';
import { StockInDto } from './dto/stock-in.dto';
import { CurrentUser } from '@auth/models/auth.model';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(WarehouseService.name)
    private readonly logger: PinoLogger,
  ) {}

  async createWarehouse(dto: CreateWarehouseDto) {
    try {
      const warehouse = await this.prisma.warehouse.create({
        data: {
          name: dto.name,
          storeId: dto.storeId,
          staffs: {
            create: {
              staffId: dto.ownerId,
            },
          },
        },
      });

      return { warehouse, worker: null };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findAll(pageSize = 10, currentPage = 1) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const result = await this.prisma.warehouse.findMany({
        skip: skip,
        take: +pageSize,
      });
      const count = await this.prisma.warehouse.count();
      return {
        currentPage,
        pageSize,
        total: count,
        data: result,
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  findOne(id: string) {
    try {
      return this.prisma.warehouse.findUnique({
        where: { id },
        include: {
          inventory: {
            include: {
              variant: {
                include: {
                  product: true,
                },
              },
            },
          },
          stockMovements: true,
          staffs: true,
          orders: true,
        },
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  /** Owner: any warehouse of their store; manager: only their warehouses. */
  private assertWarehouseAccess(
    warehouse: { id: string; storeId: string },
    user: CurrentUser,
  ) {
    if (!user.staff || user.staff.storeId !== warehouse.storeId) {
      throw new ForbiddenException('No access to this warehouse');
    }
    if (user.role === UserRole.OWNER || user.staff.role === StaffRole.OWNER)
      return;
    if (!user.staff.warehouse.some((w) => w.warehouseId === warehouse.id)) {
      throw new ForbiddenException('No access to this warehouse');
    }
  }

  private validateMovement(dto: InventoryMovementDto) {
    const allowed =
      (dto.type === StockMovementType.IN &&
        (dto.reason === StockMovementReason.PURCHASE ||
          dto.reason === StockMovementReason.ADJUSTMENT)) ||
      (dto.type === StockMovementType.OUT &&
        dto.reason === StockMovementReason.ADJUSTMENT);
    if (!allowed) {
      throw new BadRequestException(
        `Movement ${dto.type}/${dto.reason} is not allowed here`,
      );
    }
    if (
      dto.reason === StockMovementReason.PURCHASE &&
      dto.costPrice === undefined
    ) {
      throw new BadRequestException('costPrice is required for a purchase');
    }
  }

  async inventoryMovement(
    warehouseId: string,
    dto: InventoryMovementDto,
    user: CurrentUser,
  ) {
    this.logger.debug(
      {
        warehouseId,
        variantId: dto.variantId,
        type: dto.type,
        quantity: dto.quantity,
      },
      'Processing inventory movement',
    );
    this.validateMovement(dto);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.findUnique({
          where: { id: dto.variantId },
        });
        if (!variant) {
          this.logger.warn(
            { warehouseId, variantId: dto.variantId },
            'Inventory movement rejected: variant not found',
          );
          throw new NotFoundException('Product variant not found');
        }
        const warehouse = await tx.warehouse.findUnique({
          where: { id: warehouseId },
        });
        if (!warehouse || warehouse.id !== variant.warehouseId) {
          this.logger.warn(
            { warehouseId, variantId: dto.variantId },
            'Inventory movement rejected: warehouse not found or mismatch',
          );
          throw new NotFoundException('Warehouse not found');
        }
        this.assertWarehouseAccess(warehouse, user);

        if (dto.type === StockMovementType.IN) {
          await tx.inventory.upsert({
            where: {
              warehouseId_variantId: {
                warehouseId: warehouse.id,
                variantId: variant.id,
              },
            },
            update: { quantity: { increment: dto.quantity } },
            create: {
              warehouseId: warehouse.id,
              variantId: variant.id,
              quantity: dto.quantity,
            },
          });
        } else {
          // Atomic check: stock never goes below zero
          const updated = await tx.inventory.updateMany({
            where: {
              warehouseId: warehouse.id,
              variantId: variant.id,
              quantity: { gte: dto.quantity },
            },
            data: { quantity: { decrement: dto.quantity } },
          });
          if (updated.count === 0) {
            throw new BadRequestException('Insufficient stock for write-off');
          }
        }
        await tx.stockMovement.create({
          data: {
            type: dto.type,
            reason: dto.reason,
            quantity: dto.quantity,
            variantId: variant.id,
            warehouseId: warehouse.id,
            unitCost:
              dto.costPrice === undefined
                ? null
                : new Prisma.Decimal(dto.costPrice),
            createdById: user.staff.id,
          },
        });
        if (dto.price !== undefined) {
          await tx.productVariant.update({
            where: { id: variant.id },
            data: {
              price: new Prisma.Decimal(dto.price),
            },
          });
        }
        return { message: 'Inventory movement recorded' };
      });
      this.logger.info(
        {
          warehouseId,
          variantId: dto.variantId,
          type: dto.type,
          quantityDelta: dto.quantity,
        },
        'Inventory movement recorded',
      );
      return result;
    } catch (error: any) {
      this.logger.error(
        { warehouseId, variantId: dto.variantId, err: error.message },
        'Failed to process inventory movement',
      );
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error.response || error.message);
    }
  }
}
