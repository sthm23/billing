import { BadRequestException, NotFoundException, Injectable } from '@nestjs/common';
import { CreateOrderDto, CreateOrderItemDto, CreateOrderPaymentDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CurrentUser } from '@auth/models/auth.model';
import { OrderStatus, StockMovementReason, StockMovementType, UserRole, UserType } from '@generated/enums';
import { Prisma } from '@generated/client';
import { CreateReturnOrderDto } from './dto/create-return.dto';


@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }
  async create(createOrderDto: CreateOrderDto, user: CurrentUser) {
    try {
      if (!user || !user.staff) {
        throw new BadRequestException('Staff not found');
      }

      const warehouseIds = user.staff.warehouse.map(w => w.warehouseId);
      if (user.staff.storeId !== createOrderDto.storeId || !warehouseIds.includes(createOrderDto.warehouseId)) {
        throw new BadRequestException('Staff does not belong to the store or warehouse');
      }
      if (user.auth && !user.auth.isActive) {
        throw new BadRequestException('User is not active');
      }

      return this.prisma.order.create({
        data: {
          storeId: createOrderDto.storeId,
          warehouseId: createOrderDto.warehouseId,
          cashierId: user.staff.id,
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

  async createReturn(createOrderDto: CreateReturnOrderDto, user: CurrentUser) {
    const order = await this.prisma.order.findUnique({
      where: { id: createOrderDto.orderId },
      include: { items: true, payments: true }
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== OrderStatus.COMPLETED && order.status !== OrderStatus.DEBT) {
      throw new BadRequestException('Only completed or debt orders can be returned');
    }

    if (order.payments.length === 0) {
      throw new BadRequestException('Cannot return an order without payments');
    }

    try {
      return await this.prisma.$transaction(async (prisma) => {
        const returnOrder = await prisma.returnedOrder.create({
          data: {
            orderId: createOrderDto.orderId,
            createdBy: user.staff.id,
          }
        });

        const orderItemsById = new Map(order.items.map(item => [item.id, item]));

        const returnItemsData = createOrderDto.items.map(item => ({
          returnId: returnOrder.id,
          orderItemId: item.orderItemId,
          quantity: item.quantity,
        }));
        await prisma.returnItem.createMany({
          data: returnItemsData
        });

        for (let i = 0; i < createOrderDto.items.length; i++) {
          const returnedItem = createOrderDto.items[i];
          const orderItem = orderItemsById.get(returnedItem.orderItemId);
          if (!orderItem) {
            throw new BadRequestException(`Order item not found: ${returnedItem.orderItemId}`);
          }
          if (returnedItem.quantity > orderItem.quantity) {
            throw new BadRequestException(`Return quantity exceeds purchased quantity for item: ${returnedItem.orderItemId}`);
          }
          await prisma.stockMovement.create({
            data: {
              type: StockMovementType.IN,
              reason: StockMovementReason.RETURN,
              quantity: returnedItem.quantity,
              unitCost: new Prisma.Decimal(returnedItem.unitCost),
              variantId: orderItem.variantId,
              warehouseId: order.warehouseId,
              createdById: user.staff.id,
            }
          });
        }


        let returnPayments = 0
        const createdPayments = createOrderDto.returnPayments.map(payment => {
          returnPayments += +payment.amount
          return {
            returnOrderId: returnOrder.id,
            type: payment.type,
            amount: payment.amount,
            createdBy: user.staff.id
          }
        })

        if (+returnPayments > +order.totalAmount) {
          throw new BadRequestException(`Return amount exceeds order total`);
        }

        await prisma.returnPayment.createMany({
          data: createdPayments
        });

        return Promise.resolve({ message: 'Order returned successfully' });
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createOrderItems(dto: CreateOrderItemDto) {
    try {
      await this.prisma.$transaction(async (prisma) => {
        const order = await prisma.order.findUnique({
          where: { id: dto.orderId },
          include: { items: true },
        });

        if (!order) throw new BadRequestException('Order not found');
        if (order.status !== OrderStatus.CREATED && order.status !== OrderStatus.HOLD) {
          throw new BadRequestException('Cannot add items to an order that is not in CREATED or HOLD status');
        }

        // 1) Суммируем входящие количества по variantId
        const incomingQuantityByVariant = new Map<string, number>();
        const variantIds: string[] = [];

        for (const item of dto.items) {
          if (item.quantity >= 1) {
            // if (item.quantity <= 0) throw new BadRequestException(`Invalid quantity for variant: ${item.variantId}`);
            const stock = incomingQuantityByVariant.get(item.variantId) ?? 0;
            incomingQuantityByVariant.set(item.variantId, stock + item.quantity);
            variantIds.push(item.variantId);
          }
        }

        // 2) Проверяем, что варианты существуют и принадлежат магазину заказа
        const variants = await prisma.productVariant.findMany({
          where: { id: { in: Array.from(new Set(variantIds)) } },
          select: { id: true, storeId: true },
        });

        const variantById = new Map(variants.map(v => [v.id, v]));
        for (const variantId of incomingQuantityByVariant.keys()) {
          const variant = variantById.get(variantId);
          if (!variant) throw new BadRequestException(`Product variant not found: ${variantId}`);
          if (variant.storeId !== order.storeId) {
            throw new BadRequestException(`Variant ${variantId} does not belong to this store`);
          }
        }

        // 3) Берем остатки ТОЛЬКО по складу заказа
        const inventories = await prisma.inventory.findMany({
          where: {
            warehouseId: order.warehouseId,
            variantId: { in: Array.from(incomingQuantityByVariant.keys()) },
          },
          select: { variantId: true, quantity: true },
        });

        const invQtyByVariant = new Map(inventories.map(i => [i.variantId, i.quantity]));

        // 4) Валидация: после добавления позиций в заказ, не превышаем остаток на складе
        for (const [variantId, incomingQty] of incomingQuantityByVariant.entries()) {
          const invQty = invQtyByVariant.get(variantId);
          if (invQty === undefined) {
            throw new BadRequestException(`Inventory row not found for variant: ${variantId}`);
          }

          if (invQty < incomingQty) {
            throw new BadRequestException(
              `Insufficient stock for variant: ${variantId} (available: ${invQty}, requested total in order: ${incomingQty})`,
            );
          }
        }

        // 5) Создаем позиции и пересчитываем сумму добавления
        let totalAmountToAdd = 0;

        for (const item of dto.items) {
          const retailPrice = +item.retailPrice;
          const sale = +item.sale;
          const priceAtSale = sale > 0 ? retailPrice - sale : retailPrice;

          totalAmountToAdd += priceAtSale * item.quantity;

          if (item.itemId) {
            const existingItem = await prisma.orderItem.findUnique({ where: { id: item.itemId } });

            if (!existingItem) {
              await prisma.orderItem.create({
                data: {
                  orderId: dto.orderId,
                  variantId: item.variantId,
                  quantity: item.quantity,
                  retailPrice: item.retailPrice,
                  sale: item.sale,
                  costAtSale: item.costAtSale,
                },
              });
            } else {
              await prisma.orderItem.update({
                where: { id: item.itemId },
                data: {
                  variantId: item.variantId,
                  quantity: item.quantity,
                  retailPrice: item.retailPrice,
                  sale: item.sale,
                  costAtSale: item.costAtSale
                }
              });
            }
          } else {
            await prisma.orderItem.create({
              data: {
                orderId: dto.orderId,
                variantId: item.variantId,
                quantity: item.quantity,
                retailPrice: item.retailPrice,
                sale: item.sale,
                costAtSale: item.costAtSale,
              },
            });
          }
        }
        const existingItemIds = dto.items.filter(i => i.itemId).map(i => i.itemId) as string[];
        const removedItemIds = order.items.filter(existingItem => !existingItemIds.includes(existingItem.id)).map(i => i.id);
        if (removedItemIds.length > 0) {
          await prisma.orderItem.deleteMany({
            where: { id: { in: removedItemIds } },
          });
        }

        await prisma.order.update({
          where: { id: dto.orderId },
          data: {
            totalAmount: totalAmountToAdd,
            customerId: dto.customerId ?? null,
            status: OrderStatus.HOLD
          },
        });
      });

      return Promise.resolve({ message: 'Order items created successfully' });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
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
      if (order.status !== OrderStatus.HOLD && order.status !== OrderStatus.DEBT) {
        throw new BadRequestException('Cannot add payment to an order that is not in HOLD or DEBT status');
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
              createdBy: user.staff.id
            }
          });
        }

        // Суммируем количество по variantId, чтобы списывать один раз на вариант
        const qtyByVariantId = new Map<string, number>();
        for (const item of order.items) {
          qtyByVariantId.set(item.variantId, (qtyByVariantId.get(item.variantId) ?? 0) + item.quantity);
        }

        const stockMovementsData = order.items.map(item => ({
          variantId: item.variantId,
          quantity: item.quantity,
          reason: StockMovementReason.SALE,
          type: StockMovementType.OUT,
          createdById: user.staff.id,
          warehouseId: order.warehouseId,
          unitCost: item.costAtSale
        })
        );
        await prisma.stockMovement.createMany({
          data: stockMovementsData
        })


        // А списание делаем атомарно и с валидацией "не уйти в минус"
        for (const [variantId, needQty] of qtyByVariantId.entries()) {
          const updated = await prisma.inventory.updateMany({
            where: {
              warehouseId: order.warehouseId,
              variantId,
              quantity: { gte: needQty },
            },
            data: {
              quantity: { decrement: needQty },
            }
          });

          // если 0 — значит либо нет строки инвентаря, либо остатка не хватает
          if (updated.count !== 1) {
            throw new BadRequestException(`Insufficient stock for variant: ${variantId}`);
          }
        }

        const status = totalPaid >= +order.totalAmount ? OrderStatus.COMPLETED : OrderStatus.DEBT;
        const customer = dto.customerId ? await prisma.customer.findUnique({ where: { id: dto.customerId } }) : null;
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status,
            customerId: customer?.id ?? null,
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
      const params = {}

      if (user.type === UserType.STAFF) {
        params['storeId'] = user.staff.storeId
      }

      if (user.type === UserType.STAFF && user.role !== UserRole.OWNER) {
        params['cashierId'] = user.staff.id
      }

      const orders = await this.prisma.order.findMany({
        where: params,
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
        where: params,
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
      const params = {
        id,
        storeId: user.role !== UserRole.ADMIN ? user.staff.storeId : undefined,
        cashierId: user.type === UserType.STAFF ? user.staff.id : undefined
      } as Prisma.OrderFindUniqueArgs['where'];

      const order = await this.prisma.order.findUnique({
        where: params,
        include: {
          items: {
            include: {
              variant: {
                include: {
                  inventory: true,
                }
              },
            }
          },
          customer: {
            include: {
              user: true,
            }
          },
          payments: true,
        }
      });
      if (!order) {
        throw new BadRequestException('Order not found');
      }
      return Promise.resolve({
        ...order,
        items: order.items.map(item => ({
          ...item,
          variant: { ...item.variant, quantity: item.variant.inventory.reduce((sum, inv) => sum + inv.quantity, 0) }
        }))
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async remove(id: string, user: CurrentUser) {
    try {
      const params = {}
      if (user.type === UserType.STAFF) {
        params['storeId'] = user.staff.storeId
      }
      if (user.type === UserType.STAFF && user.role !== UserRole.OWNER) {
        params['cashierId'] = user.staff.id
      }
      const order = await this.prisma.order.findUnique({
        where: {
          id,
          ...params
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
      return this.prisma.order.update({
        where: { id },
        data: { status: OrderStatus.CANCELLED }
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}
