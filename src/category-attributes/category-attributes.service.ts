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

  findCategories() {
    return this.prisma.category.findMany({
      where: {
        parentId: null
      },
      include: {
        children: {
          include: { children: true }
        }
      },
    });
  }


  findTRee() {
    return this.prisma
      .$queryRaw`
    SELECT 
      c.id,
      c.name,
      CASE
        WHEN parent.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', parent.id,
          'name', parent.name,
          'parentId', parent."parentId"
        )
      END AS parent,
    COALESCE(
      jsonb_agg(
        DISTINCT jsonb_build_object('id', a.id, 'name', a.name)
      ) FILTER (WHERE a.id IS NOT NULL), 
      '[]'::jsonb) AS attribute 
    FROM "Category" c
      LEFT JOIN "Category" parent ON parent.id = c."parentId"
      LEFT JOIN "CategoriesOnAttribute" coa ON coa."categoryId" = c.id
      LEFT JOIN "Attribute" a ON a.id = coa."attributeId"
      WHERE c."parentId" IS NOT NULL -- Adjust this condition as needed!
      GROUP BY c.id, c.name, parent.id, parent.name, parent."parentId";
      `
  }

  findOne(id: string) {
    return this.prisma.category.findUnique({
      where: { id },
      include: { children: true },
    });
  }

}
