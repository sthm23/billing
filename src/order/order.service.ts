import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { PrismaService } from '@prisma/prisma.service';

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }
  create(createOrderDto: CreateOrderDto) {
    return 'This action adds a new order';
  }

  async findAll(pageSize = 10, currentPage = 1) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const result = await this.prisma.order.findMany({
        skip: skip,
        take: pageSize,
      });
      const count = await this.prisma.order.count();
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
    return `This action returns a #${id} order`;
  }

  update(id: string, updateOrderDto: UpdateOrderDto) {
    return `This action updates a #${id} order`;
  }

  remove(id: string) {
    return `This action removes a #${id} order`;
  }
}
