import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryMovementDto, CreateWarehouseDto, CreateWarehouseStaffDto } from './dto/create-warehouse.dto';
import { PrismaService } from '@prisma/prisma.service';
import { StaffRole, StockMovementReason, StockMovementType, UserType } from '@generated/enums';
import { HashingHelper } from '@shared/helper/hash.helper';
import { Prisma, Staff, User } from '@generated/client';
import { StockInDto } from './dto/stock-in.dto';
import { CurrentUser } from '@auth/models/auth.model';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,

  ) { }

  async createWarehouse(dto: CreateWarehouseDto) {
    try {
      const warehouse = await this.prisma.warehouse.create({
        data: {
          name: dto.name,
          storeId: dto.storeId,
          staffs: {
            create: {
              staffId: dto.ownerId
            }
          }
        }
      });

      return { warehouse, worker: null }
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
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
        data: result
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
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

                }
              }
            }
          },
          stockMovements: true,
          staffs: true,
          orders: true

        }
      })
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async inventoryMovement(warehouseId: string, dto: InventoryMovementDto, user: CurrentUser) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.findUnique({ where: { id: dto.variantId } });
        if (!variant) throw new NotFoundException("Product variant not found");
        const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
        if (!warehouse || warehouse.id !== variant.warehouseId) throw new NotFoundException("Warehouse not found");

        const quantity = dto.type === StockMovementType.IN ? { increment: dto.quantity } : { decrement: dto.quantity }
        await tx.inventory.update({
          where: {
            warehouseId_variantId: {
              warehouseId: warehouse.id,
              variantId: variant.id,
            },
          },
          data: {
            quantity: quantity,
          },
        });
        await tx.stockMovement.create({
          data: {
            type: dto.type,
            reason: dto.reason,
            quantity: dto.quantity,
            variantId: variant.id,
            warehouseId: warehouse.id,
            unitCost: new Prisma.Decimal(dto.costPrice),
            createdById: user.staff.id,
          }
        })
        await tx.productVariant.update({
          where: { id: variant.id },
          data: {
            price: new Prisma.Decimal(dto.price),
          }
        });
        return { message: 'Inventory added successfully' };
      })
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}
