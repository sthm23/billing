import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateWarehouseDto, CreateWarehouseStaffDto } from './dto/create-warehouse.dto';
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
          storeId: dto.storeId
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
          // _count: {
          //   select: {
          //     inventory: true,
          //     orders: true,
          //     staffs: true,
          //     stockMovements: true
          //   }
          // }

        }
      })
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  /**
  * Приход новой партии: НЕ создаём варианты заново, а увеличиваем остаток + пишем IN движение.
  */
  async stockIn(warehouseId: string, dto: StockInDto, user: CurrentUser) {
    if (!user?.staff?.id) throw new ForbiddenException('Only staff can receive stock');

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const item of dto.items) {
          // 1) Обновляем/создаём остаток
          await tx.inventory.upsert({
            where: {
              warehouseId_variantId: {
                warehouseId: warehouseId,
                variantId: item.variantId,
              },
            },
            create: {
              quantity: item.quantity,
              warehouse: { connect: { id: warehouseId } },
              variant: { connect: { id: item.variantId } },
            },
            update: {
              quantity: { increment: item.quantity },
            },
          });

          // 2) Пишем складское движение прихода (партия)
          await tx.stockMovement.create({
            data: {
              type: StockMovementType.IN,
              reason: StockMovementReason.PURCHASE,
              quantity: item.quantity,
              unitCost: new Prisma.Decimal(item.unitCost),
              warehouse: { connect: { id: warehouseId } },
              createdBy: { connect: { id: user.staff.id } },
              variant: { connect: { id: item.variantId } }, // если у тебя связь называется иначе — поправь
            },
          });
        }
      });

      return { ok: true };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findStockMovement(productId: string) {
    try {
      const movements = await this.prisma.stockMovement.findMany({
        where: { variant: { productId } },
        include: {

        }
      })
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

}
