import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateOrderDto, CreateOrderItemDto, CreateOrderPaymentDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CurrentUser } from '@auth/models/auth.model';
import { OrderStatus, StockMovementReason, StockMovementType } from '@generated/enums';
import { stat } from 'fs';

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }
  async create(createOrderDto: CreateOrderDto, user: CurrentUser) {
    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { staff: true, auth: true }
    });
    if (!userRecord || !userRecord.staff) {
      throw new BadRequestException('Staff not found');
    }
    if (userRecord.staff.storeId !== createOrderDto.storeId || userRecord.staff.warehouseId !== createOrderDto.warehouseId) {
      throw new BadRequestException('Staff does not belong to the store or warehouse');
    }
    if (userRecord.auth && !userRecord.auth.isActive) {
      throw new BadRequestException('User is not active');
    }
    try {
      return this.prisma.order.create({
        data: {
          storeId: createOrderDto.storeId,
          warehouseId: createOrderDto.warehouseId,
          cashierId: userRecord.id,
          customerId: createOrderDto?.customerId ?? null,
          channel: createOrderDto.channel,
          status: OrderStatus.CREATED,
          totalAmount: 0,
        }
      })
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createOrderItems(dto: CreateOrderItemDto) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        include: { items: true }
      });
      if (!order) {
        throw new BadRequestException('Order not found');
      }
      if (order.status !== OrderStatus.CREATED) {
        throw new BadRequestException('Cannot add items to an order that is not in CREATED status');
      }
      await this.prisma.$transaction(async (prisma) => {
        let totalAmount = 0;
        for (const item of dto.items) {
          const variant = await prisma.productVariant.findUnique({
            where: { id: item.variantId },
            include: { inventory: true }
          });
          if (!variant) {
            throw new BadRequestException(`Product variant not found: ${item.variantId}`);
          }
          const quantityInventory = variant.inventory.reduce((sum, inv) => sum + inv.quantity, 0);;
          if (quantityInventory < item.quantity) {
            throw new BadRequestException(`Insufficient stock for variant: ${item.variantId}`);
          }

          totalAmount += item.priceAtSale * item.quantity;
          await prisma.orderItem.create({
            data: {
              orderId: dto.orderId,
              variantId: item.variantId,
              quantity: item.quantity,
              priceAtSale: item.priceAtSale,
              costAtSale: item.costAtSale
            }
          });
        }
        await prisma.order.update({
          where: { id: dto.orderId },
          data: { totalAmount: { increment: totalAmount }, customerId: dto.customerId ?? null }
        });
      });
      return Promise.resolve({ message: 'Order items created successfully' });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createPayment(orderId: string, dto: CreateOrderPaymentDto, user: CurrentUser) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { payments: true, items: true }
      });
      if (!order) {
        throw new BadRequestException('Order not found');
      }
      if (order.status !== OrderStatus.CREATED) {
        throw new BadRequestException('Cannot add payment to an order that is not in CREATED status');
      }

      const totalPaidBefore = order.payments.reduce((sum, payment) => (sum + +payment.amount), 0);
      const newPaid = dto.payments.reduce((sum, payment) => (sum + +payment.amount), 0);
      const totalPaid = totalPaidBefore + newPaid;

      if (totalPaid > +order.totalAmount) {
        throw new BadRequestException('Payment amount exceeds order total');
      }

      await this.prisma.$transaction(async (prisma) => {
        for (const paymentDto of dto.payments) {
          await prisma.payment.create({
            data: {
              orderId: orderId,
              amount: paymentDto.amount,
              type: paymentDto.type,
              createdBy: user.id
            }
          });
        }

        for (const item of order.items) {
          const variant = await prisma.productVariant.findUnique({
            where: { id: item.variantId }
          });
          if (variant) {
            await prisma.stockMovement.create({
              data: {
                variantId: item.variantId,
                quantity: item.quantity,
                reason: StockMovementReason.SALE,
                type: StockMovementType.OUT,
                createdById: user.staff.id,
                warehouseId: order.warehouseId,
                unitCost: item.costAtSale
              }
            });

            await prisma.inventory.updateMany({
              where: {
                warehouseId: order.warehouseId,
                variantId: item.variantId
              },
              data: {
                quantity: { decrement: item.quantity }
              }
            });
          }
        }
        const status = totalPaid >= +order.totalAmount ? OrderStatus.COMPLETED : OrderStatus.DEBT;
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status,
            customerId: order.customerId ?? null,
            paidAmount: status === OrderStatus.COMPLETED ? +order.totalAmount : totalPaid
          }
        });
      });
      return Promise.resolve({ message: 'Payment created successfully' });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAll(pageSize = 10, currentPage = 1) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const result = await this.prisma.order.findMany({
        skip: skip,
        take: +pageSize,
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
