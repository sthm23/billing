import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCategoryAttributeDto } from './dto/create-category-attribute.dto';
import { PrismaService } from '@prisma/prisma.service';
import { Staff } from '@generated/client';
import { UserAuth } from '@auth/models/auth.model';
import { count } from 'console';

@Injectable()
export class CategoryAttributesService {
  constructor(private prisma: PrismaService,) { }

  async create(dto: CreateCategoryAttributeDto) {
    try {
      const category = await this.prisma.category.upsert({
        where: { name: dto.name },
        update: {},
        create: {
          name: dto.name,
          parentId: dto?.parentId ?? null,
        },
      })
      return category;
    } catch (error: any) {
      throw new BadRequestException('Category could not be created: ' + error.message);
    }
  }

  async findBrands(pageSize = 10, currentPage = 1) {
    try {
      const count = await this.prisma.brand.count();
      const data = await this.prisma.brand.findMany({
        skip: (currentPage - 1) * pageSize,
        take: +pageSize,
      });

      return {
        currentPage,
        pageSize,
        total: count,
        data
      }
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findStoreBrands(storeId: string) {
    try {
      const brands = await this.prisma.brandsOnStore.findMany({
        where: { storeId },
        include: { brand: true },
      });
      return brands.map((b) => b.brand);
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  findCategories() {
    return this.prisma.category.findMany({
      where: {
        parentId: null
      },
      include: {
        store: true,
        children: {
          include: { children: { include: { children: true } } }
        }
      },
    });
  }

  async findStoreCategories(storeId: string) {
    try {
      const categories = await this.prisma.categoriesOnStore.findMany({
        where: {
          storeId
        },
        include: {
          category: {
            include: {
              children: {
                include: {
                  children: true
                }
              }
            }
          }
        },
      });
      return categories.map((c) => c.category);
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
  findAttributes() {
    return this.prisma.attribute.findMany();
  }

  findOne(id: string) {
    return this.prisma.category.findUnique({
      where: { id },
      include: {
        children: {
          include: {
            children: true
          }
        }
      },
    });
  }

}
