import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateWarehouseDto, CreateWarehouseStaffDto } from './dto/create-warehouse.dto';
import { PrismaService } from '@prisma/prisma.service';
import { StaffRole, UserType } from '@generated/enums';
import { HashingHelper } from '@shared/helper/hash.helper';
import { User } from '@generated/client';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,

  ) { }

  async create(dto: CreateWarehouseDto) {
    try {
      const warehouse = await this.prisma.warehouse.create({
        data: {
          name: dto.name,
          storeId: dto.storeId
        }
      });

      if (dto.worker) {
        const worker = await this.createWarehouseStaff(dto?.worker);
        await this.prisma.staffWarehouse.createMany({
          data: [
            { staffId: dto.ownerId, warehouseId: warehouse.id },
            { staffId: worker.id, warehouseId: warehouse.id }
          ]
        })
        return {
          warehouse,
          worker
        }
      } else {
        await this.prisma.staffWarehouse.create({
          data: {
            staffId: dto.ownerId,
            warehouseId: warehouse.id
          }
        })
      }

      return { warehouse, worker: null }
    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }

  private async createWarehouseStaff(dto: CreateWarehouseStaffDto): Promise<User> {
    try {
      const passwordHash = await HashingHelper.hash(dto.password, 10);
      return this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          phone: dto.phone,
          type: UserType.STAFF,
          auth: {
            create: {
              login: dto.login,
              passwordHash
            }
          },
          staff: {
            create: {
              role: StaffRole.WAREHOUSE,
              storeId: dto.storeId
            }
          }
        }
      });

    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }

  findAll() {
    try {
      return this.prisma.warehouse.findMany()
    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }

  findOne(id: string) {
    try {
      return this.prisma.warehouse.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              inventory: true,
              orders: true,
              staffWarehouses: true,
              stockMovements: true
            }
          }

        }
      })
    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }
}
