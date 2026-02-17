import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateOwnerDto, CreateStaffDto, CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { PrismaService } from '@prisma/prisma.service';
import { StaffRole, UserRole, UserType } from '@generated/enums';
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
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId }
      });
      if (!owner) {
        throw new NotFoundException('Owner not found');
      }
      if (!category) {
        throw new NotFoundException('Category not found');
      }

      let store;

      await this.prisma.$transaction(async (tx) => {
        store = await tx.store.create({
          data: {
            name: dto.name,
            createdBy: creatorId,
            ownerId: dto.ownerId,
            categories: {
              create: {
                category: {
                  connect: { id: category.id }
                }
              }
            },
            warehouse: {
              create: {
                name: dto.warehouseName,
              }
            },
            brands: {
              createMany: {
                data: [
                  ...dto.brandIds.map(brandId => ({ brandId }))
                ]
              }
            }
          },
          include: {
            warehouse: true
          }
        })
        await tx.staff.create({
          data: {
            userId: owner.id,
            storeId: store.id,
            role: StaffRole.OWNER,
            warehouseId: store?.warehouse?.id ?? null
          }
        })
      })
      return Promise.resolve(store);
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
      const staff = await this.prisma.user.create({
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
              storeId: dto.storeId,
              warehouseId: dto.warehouseId
            }
          }
        },
        include: {
          auth: true,
          staff: true
        }
      })
      return staff
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAll(pageSize: number = 10, currentPage: number = 1) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const result = await this.prisma.store.findMany({
        skip: skip,
        take: +pageSize,
        include: {
          warehouse: true,
          staff: true,
          categories: {
            include: {
              category: true,
            }
          }
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

  async findStoreById(id: string) {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              products: true,
              orders: true
            }
          },
          staff: true,
          warehouse: true,
          categories: true,
        }
      })
      if (!store) {
        throw new NotFoundException('Store not found');
      }
      return store;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}