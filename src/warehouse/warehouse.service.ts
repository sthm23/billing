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

  async create(dto: CreateWarehouseDto, creatorId: string) {
    try {
      const warehouse = this.prisma.warehouse.create({
        data: {
          name: dto.name,
          storeId: dto.storeId
        }
      });
      const worker = this.createWarehouseStaff(dto?.worker);
      const result = await Promise.all([warehouse, worker]);

      return {
        warehouse: result[0],
        worker: result[1]
      }

    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }

  private async createWarehouseStaff(dto?: CreateWarehouseStaffDto): Promise<User | null> {
    try {
      if (dto) {
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
      }
      return Promise.reject(null)
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
