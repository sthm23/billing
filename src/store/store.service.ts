import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateOwnerDto, CreateStaffDto, CreateStoreDto } from './dto/create-store.dto';
import { PrismaService } from '@prisma/prisma.service';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { HashingHelper } from '@shared/helper/hash.helper';
import { CurrentUser } from '@auth/models/auth.model';
import { UpdateStoreDto } from './dto/update-store.dto';

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

      return this.prisma.$transaction(async (tx) => {
        const store = await tx.store.create({
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

            brands: {
              createMany: {
                data: dto.brandIds.map(brandId => ({ brandId }))
              }
            },
            attributes: {
              createMany: {
                data: dto.attributeIds.map(attrId => ({ attributeId: attrId }))
              }
            },
          },
          include: {
            warehouse: true
          }
        })
        const warehouse = await tx.warehouse.create({
          data: {
            name: dto.warehouseName,
            storeId: store.id,
          }
        })
        await tx.staff.create({
          data: {
            userId: owner.id,
            storeId: store.id,
            role: StaffRole.OWNER,
            warehouse: {
              create: {
                warehouseId: warehouse.id
              }
            }
          }
        })

        return store;
      })
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async updateStore(id: string, dto: UpdateStoreDto) {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id },
        include: {
          brands: true,
          attributes: true,
          warehouse: true,
        }
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }
      const nextAttributeIds = [...new Set(dto.attributeIds ?? [])];
      const nextBrandIds = [...new Set(dto.brandIds ?? [])];

      const currentAttributeIds = store.attributes.map((attr) => attr.attributeId);
      const currentBrandIds = store.brands.map((brand) => brand.brandId);

      const nextAttributeSet = new Set(nextAttributeIds);
      const nextBrandSet = new Set(nextBrandIds);

      const currentAttributeSet = new Set(currentAttributeIds);
      const currentBrandSet = new Set(currentBrandIds);

      const newAttributes = nextAttributeIds.filter((attrId) => !currentAttributeSet.has(attrId));
      const removedAttributes = currentAttributeIds.filter((attrId) => !nextAttributeSet.has(attrId));

      const newBrands = nextBrandIds.filter((brandId) => !currentBrandSet.has(brandId));
      const removedBrands = currentBrandIds.filter((brandId) => !nextBrandSet.has(brandId));

      return this.prisma.$transaction(async (tx) => {
        await tx.store.update({
          where: { id },
          data: {
            ...(dto.name ? { name: dto.name } : {}),
          },
        });

        if (dto.warehouseName && store.warehouse.length > 0) {
          await tx.warehouse.update({
            where: { id: store.warehouse[0].id },
            data: { name: dto.warehouseName },
          });
        }

        if (removedAttributes.length > 0) {
          await tx.attributeOnStore.deleteMany({
            where: {
              storeId: id,
              attributeId: { in: removedAttributes },
            },
          });
        }

        if (newAttributes.length > 0) {
          await tx.attributeOnStore.createMany({
            data: newAttributes.map((attrId) => ({ attributeId: attrId, storeId: id })),
            skipDuplicates: true,
          });
        }

        if (removedBrands.length > 0) {
          await tx.brandsOnStore.deleteMany({
            where: {
              storeId: id,
              brandId: { in: removedBrands },
            },
          });
        }

        if (newBrands.length > 0) {
          await tx.brandsOnStore.createMany({
            data: newBrands.map((brandId) => ({ brandId, storeId: id })),
            skipDuplicates: true,
          });
        }

        return tx.store.findUnique({
          where: { id },
          include: {
            brands: true,
            attributes: true,
            warehouse: true,
          }
        });
      });

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
              warehouse: {
                create: {
                  warehouseId: dto.warehouseId
                }
              }
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

  async findAll(pageSize: number = 10, currentPage: number = 1, user: CurrentUser) {
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

  async findStoreById(id: string, user: CurrentUser) {
    try {
      if (user.role === UserRole.OWNER && user.staff.storeId !== id) {
        throw new NotFoundException('Store not found');
      }

      const store = await this.prisma.store.findUnique({
        where: { id },
        include: {
          staff: true,
          warehouse: true,
          categories: true,
          attributes: true,
          brands: true,
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

  async findStaffStockMovements(userId: string, user: CurrentUser) {

    try {
      const movements = await this.prisma.stockMovement.findMany({
        where: {
          createdById: userId,
        },
        omit: {
          unitCost: user.role !== UserRole.OWNER
        },
        include: {
          variant: true
        }
      });
      return movements;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}