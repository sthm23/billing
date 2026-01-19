import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateOwnerDto, CreateStaffDto, CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { PrismaService } from '@prisma/prisma.service';
import { UserRole, UserType } from '@generated/enums';
import { HashingHelper } from '@shared/helper/hash.helper';

@Injectable()
export class StoreService {

  constructor(
    private readonly prisma: PrismaService,

  ) { }

  async createStore(dto: CreateStoreDto, creatorId: string) {
    try {
      const owner = await this.prisma.user.findUnique({
        where: { id: dto.ownerId }
      });
      if (!owner) {
        throw new NotFoundException('Owner not found');
      }
      const store = await this.prisma.store.create({
        data: {
          name: dto.name,
          createdBy: creatorId,
          ownerId: owner.id,
        }
      })

      return store
    } catch (error: any) {
      throw new BadRequestException(error.error)
    }
  }

  async createOwner(dto: CreateOwnerDto) {
    try {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          OR: [
            {
              auth: {
                login: dto.login
              }
            },
            { phone: dto.phone }
          ]
        },
        include: { auth: true },
      });
      if (existingUser) {
        throw new BadRequestException('User with this login already exists');
      }

      const passwordHash = await HashingHelper.hash(dto.password, 10);
      return this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          phone: dto.phone,
          role: UserRole.OWNER,
          type: UserType.STAFF,
          auth: {
            create: {
              login: dto.login,
              passwordHash
            }
          }
        }
      })
    } catch (error: any) {
      console.log(error);

      throw new BadRequestException(error.error)
    }
  }

  async createStaff(dto: CreateStaffDto) {
    try {
      const passwordHash = await HashingHelper.hash(dto.password, 10);
      return this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
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

        await tx.staffWarehouse.create({
          data: {
            staffId: user.staff!.id,
            warehouseId: dto.warehouseId
          }
        })
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
