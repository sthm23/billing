import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateOwnerDto, CreateStaffDto, CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { PrismaService } from '@prisma/prisma.service';
import { UserRole, UserType } from '@generated/enums';
import { HashingHelper } from '@shared/helper/hash.helper';
import { UserAuth } from '@auth/models/auth.model';

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
      throw new BadRequestException(error.response || error.message)
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

      if (existingUser) throw new ConflictException('Login or Phone is exist!');

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
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createStaff(dto: CreateStaffDto) {
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
      if (existingUser) throw new ConflictException('Login or Phone is exist!');
      const passwordHash = await HashingHelper.hash(dto.password, 10);
      await this.prisma.$transaction(async (tx) => {
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
            staff: true,
            auth: true
          }
        })

        await tx.staffWarehouse.create({
          data: {
            staffId: user.staff!.id,
            warehouseId: dto.warehouseId
          }
        })
      })
      return { message: 'Staff created successfully' }
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAll(pageSize: number = 10, currentPage: number = 1, user: UserAuth) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const result = await this.prisma.store.findMany({
        skip: skip,
        take: pageSize,
        where: user.role === UserRole.OWNER ? { ownerId: user.id } : {},
        include: {
          warehouses: true,
          staff: true,
        }
      });
      const count = await this.prisma.store.count();
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
      throw new BadRequestException(error.response || error.message)
    }
  }
}
