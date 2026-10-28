import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CreateAttributeDto, CreateAttributeValueDto } from './dto/create-category-attribute.dto';
import { PrismaService } from '@prisma/prisma.service';
import { AttributeType } from '@generated/enums';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { AttributeParams } from './dto/attribute-params.dto';

@Injectable()
export class CategoryAttributesService {
  constructor(
    private prisma: PrismaService,
    @InjectPinoLogger(CategoryAttributesService.name) private readonly logger: PinoLogger,
  ) { }

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
  async findAttributes({ currentPage = 1, pageSize = 10 }: AttributeParams) {
    try {
      const skip = (currentPage - 1) * pageSize;
      const take = +pageSize;
      const data = await this.prisma.attribute.findMany({
        skip,
        take: +take,
      });
      const totalOrders = await this.prisma.attribute.count();
      return {
        currentPage,
        pageSize,
        total: totalOrders,
        data
      }
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
      const attribute = await this.prisma.attribute.create({
        data: {
          name: dto.name,
          type: dto.type
        }
      })
      this.logger.info({ attributeId: attribute.id, name: dto.name }, 'Attribute created');
      return attribute;
    } catch (error: any) {
      this.logger.error({ name: dto.name, err: error.message }, 'Failed to create attribute');
      throw new BadRequestException(error.response || error.message)
    }
  }
  async createAttributeValue(dto: CreateAttributeValueDto) {
    try {
      let valueType = dto.value.trim().toLocaleLowerCase();
      if (valueType === 'true' || valueType === 'false') {
        valueType = 'boolean';
      } else if (!isNaN(Number(valueType))) {
        valueType = 'number';
      } else {
        valueType = 'string';
      }

      const result = await this.prisma.attributeValue.create({
        data: {
          attributeId: dto.attributeId,
          valueString: valueType === 'string' ? dto.value : null,
          valueBool: valueType === 'boolean' ? dto.value === 'true' : null,
          valueNumber: valueType === 'number' ? Number(dto.value) : null
        }
      })
      this.logger.info({ attributeValueId: result.id, attributeId: dto.attributeId }, 'Attribute value created');
      return Promise.resolve({
        id: result.id,
        attributeId: result.attributeId,
        attributeName: valueType === 'string' ? result.valueString
          : valueType === 'boolean' ? Boolean(result.valueBool)
            : valueType === 'number' ? Number(result.valueNumber) : null
      })
    } catch (error: any) {
      this.logger.error({ attributeId: dto.attributeId, err: error.message }, 'Failed to create attribute value');
      throw new BadRequestException(error.response || error.message)
    }
  }
}
