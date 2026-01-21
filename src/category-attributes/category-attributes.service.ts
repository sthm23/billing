import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCategoryAttributeDto } from './dto/create-category-attribute.dto';
import { UpdateCategoryAttributeDto } from './dto/update-category-attribute.dto';
import { PrismaClient } from '@generated/client';

@Injectable()
export class CategoryAttributesService {
  constructor(private prisma: PrismaClient) { }

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

  findAll() {
    return this.prisma.category.findMany();
  }

  findTRee() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      include: { children: true },
    });
  }

  findOne(id: string) {
    return this.prisma.category.findUnique({
      where: { id },
    });
  }

}
