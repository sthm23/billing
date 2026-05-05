import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateAttributeDto, CreateAttributeValueDto } from './dto/create-category-attribute.dto';
import { PrismaService } from '@prisma/prisma.service';
import { AttributeType } from '@generated/enums';

@Injectable()
export class CategoryAttributesService {
  constructor(private prisma: PrismaService,) { }

  async findBrands() {
    try {
      return this.prisma.brand.findMany();
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

  async findTags() {
    try {
      return this.prisma.tag.findMany({
        include: {
          values: true
        }
      });
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
  async findAttributes() {
    try {
      return this.prisma.attribute.findMany();
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAttributeItem(attrId: string) {

    try {
      const attributes = await this.prisma.attribute.findUnique({
        where: {
          id: attrId
        },
        include: {
          values: true
        }
      });
      return Promise.resolve({
        ...attributes,
        values: attributes?.values.map(el => ({
          id: el.id,
          attributeId: el.attributeId,
          value: el.valueString !== null ? el.valueString
            : el.valueBool !== null ? Boolean(el.valueBool)
              : el.valueNumber !== null ? Number(el.valueNumber) : null
        })) ?? []
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findStoreAttributes(storeId: string) {
    try {
      const attributes = await this.prisma.attributeOnStore.findMany({
        where: {
          storeId
        },
        include: {
          attribute: true
        }
      })
      return attributes.map((a) => a.attribute);
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async getAttributeItems(ids: string[]) {
    try {
      const attributeItems = await this.prisma.attributeValue.findMany({
        where: {
          attributeId: {
            in: ids
          }
        },
        include: {
          attribute: true
        }
      })
      return attributeItems.map(el => {
        const value = el.valueString !== null ? el.valueString
          : el.valueBool !== null ? Boolean(el.valueBool)
            : el.valueNumber !== null ? Number(el.valueNumber) : null;
        return {
          id: el.id,
          attributeId: el.attributeId,
          attributeName: el.attribute.name,
          value: value
        }
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createAttribute(dto: CreateAttributeDto) {
    try {
      return this.prisma.attribute.create({
        data: {
          name: dto.name,
          type: dto.type
        }
      })
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
  async createAttributeValue(dto: CreateAttributeValueDto) {
    try {
      let valueType = dto.name.trim().toLocaleLowerCase();
      if (valueType === 'true' || valueType === 'false') {
        valueType = 'boolean';
      } else if (!isNaN(Number(valueType))) {
        valueType = 'number';
      } else {
        valueType = 'string';
      }

      return await this.prisma.attributeValue.create({
        data: {
          attributeId: dto.attributeId,
          valueString: valueType === 'string' ? dto.name : null,
          valueBool: valueType === 'boolean' ? dto.name === 'true' : null,
          valueNumber: valueType === 'number' ? Number(dto.name) : null
        }
      })
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}
