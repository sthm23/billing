import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateOrderDto, CreateOrderItemDto, CreateOrderPaymentDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CurrentUser } from '@auth/models/auth.model';
import { OrderStatus, StockMovementReason, StockMovementType, UserRole } from '@generated/enums';


@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }
  async create(createOrderDto: CreateOrderDto, user: CurrentUser) {

    if (!user || !user.staff) {
      throw new BadRequestException('Staff not found');
    }
    if (user.staff.storeId !== createOrderDto.storeId || user.staff.warehouseId !== createOrderDto.warehouseId) {
      throw new BadRequestException('Staff does not belong to the store or warehouse');
    }
    if (user.auth && !user.auth.isActive) {
      throw new BadRequestException('User is not active');
    }
    try {
      return this.prisma.order.create({
        data: {
          storeId: createOrderDto.storeId,
          warehouseId: createOrderDto.warehouseId,
          cashierId: user.id,
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
          const quantityInventory = variant.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
          if (quantityInventory < item.quantity) {
            throw new BadRequestException(`Insufficient stock for variant: ${item.variantId}`);
          }
          const priceAtSale = item.sale > 0 ? item.retailPrice - item.sale : item.retailPrice;
          totalAmount += priceAtSale * item.quantity;
          await prisma.orderItem.create({
            data: {
              orderId: dto.orderId,
              variantId: item.variantId,
              quantity: item.quantity,
              retailPrice: item.retailPrice,
              sale: item.sale,
              costAtSale: item.costAtSale
            }
          });
        }
        await prisma.order.update({
          where: { id: dto.orderId },
          data: { totalAmount: { increment: totalAmount }, customerId: dto.customerId ?? null, status: OrderStatus.HOLD }
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

  async findAll(pageSize = 10, currentPage = 1, user: CurrentUser) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const orders = await this.prisma.order.findMany({
        where: {
          storeId: user.role !== UserRole.ADMIN ? user.staff.storeId : undefined,
          cashierId: user.role === UserRole.USER ? user.id : undefined
        },
        include: {
          _count: {
            select: { items: true, payments: true }
          },
          cashier: true,
          customer: true,
          store: true,
          warehouse: true
        },
        skip: skip,
        take: +pageSize,
      })
      const totalOrders = await this.prisma.order.count({
        where: {
          storeId: user.role !== UserRole.ADMIN ? user.staff.storeId : undefined,
          cashierId: user.role === UserRole.USER ? user.id : undefined
        }
      })
      return {
        currentPage,
        pageSize,
        total: totalOrders,
        data: orders.map(order => ({
          id: order.id,
          store: order.store,
          warehouse: order.warehouse,
          cashier: order.cashier,
          customer: order.customer,
          channel: order.channel,
          status: order.status,
          totalAmount: order.totalAmount,
          paidAmount: order.paidAmount,
          createdAt: order.createdAt,
          itemsCount: order._count.items,
          paymentsCount: order._count.payments,
        }))
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findOne(id: string, user: CurrentUser) {
    try {
      const order = await this.prisma.order.findUnique({
        where: {
          id,
          storeId: user.role !== UserRole.ADMIN ? user.staff.storeId : undefined,
          cashierId: user.role === UserRole.USER ? user.id : undefined
        },
        include: {
          items: {
            include: {
              variant: true,
            }
          },
          payments: true,
        }
      });
      if (!order) {
        throw new BadRequestException('Order not found');
      }
      return order;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  update(id: string, updateOrderDto: UpdateOrderDto) {
    return `This action updates a #${id} order`;
  }

  async remove(id: string, user: CurrentUser) {
    try {
      const order = await this.prisma.order.findUnique({
        where: {
          id,
          storeId: user.role !== UserRole.ADMIN ? user.staff.storeId : undefined,
          cashierId: user.role === UserRole.USER ? user.id : undefined
        },
        include: { items: true, payments: true }
      });
      if (!order) {
        throw new BadRequestException('Order not found');
      }
      if (order.status === OrderStatus.COMPLETED || order.status === OrderStatus.DEBT) {
        throw new BadRequestException('Cannot cancel a completed or debt order');
      }
      if (order.payments.length > 0) {
        throw new BadRequestException('Cannot cancel an order with payments');
      }
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Order is already cancelled');
      }
      if (order.items.length > 0) {
        throw new BadRequestException('Cannot cancel an order with items');
      }
      return this.prisma.order.update({
        where: { id },
        data: { status: OrderStatus.CANCELLED }
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}
