import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStaffDto, CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { PrismaService } from '@prisma/prisma.service';
import { UserType } from '@generated/enums';
import { HashingHelper } from '@shared/helper/hash.helper';

@Injectable()
export class StoreService {

  constructor(
    private readonly prisma: PrismaService,

  ) { }

  async create(dto: CreateStoreDto, creatorId: string) {
    try {
      const passwordHash = await HashingHelper.hash(dto.password, 10);
      const owner = await this.prisma.user.create({
        data: {
          fullName: dto.ownerFullName,
          phone: dto.phone,
          type: UserType.STAFF,
          auth: {
            create: {
              login: dto.login,
              passwordHash
            }
          }
        }
      })
      const store = await this.prisma.store.create({
        data: {
          name: dto.name,
          createdBy: creatorId,
          ownerId: owner.id
        }
      })

      return store
    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }

  async createStaff(dto: CreateStaffDto) {
    try {
      const passwordHash = await HashingHelper.hash(dto.password, 10);
      const user = await this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          phone: dto.phone,
          type: UserType.STAFF,
          auth: {
            create: {
              login: dto.login,
              passwordHash,
            }
          },
          staff: {
            create: {
              role: dto.role,
              storeId: dto.storeId
            }
          }
        },
        include: {
          staff: true
        }
      })

      await this.prisma.staffWarehouse.create({
        data: {
          staffId: user.staff!.id,
          warehouseId: dto.warehouseId
        }
      })
    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }

  findAll() {
    try {
      return this.prisma.store.findMany()
    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }

  findOne(id: string) {
    try {
      return this.prisma.store.findUnique({
        where: { id },

        include: {
          _count: {
            select: {
              products: true,
              orders: true
            }
          },
          creator: true,
          owner: true,
          staff: true,
          warehouses: true
        }
      })
    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }
}
