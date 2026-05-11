import { BadRequestException, Injectable } from '@nestjs/common';
import { CreatePaymentDto, CreateReturnPaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CurrentUser } from '@auth/models/auth.model';
import { OrderStatus, PaymentType, ReturnOrderStatus } from '@generated/enums';

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }
  async create(dto: CreatePaymentDto, user: CurrentUser) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        include: { payments: true }
      });
      if (!order) {
        throw new BadRequestException('Order not found');
      }
      if (order.status !== 'DEBT') {
        throw new BadRequestException('Cannot add payment to an order that is not in DEBT status');
      }
      const totalPaid = order.payments.reduce((sum, payment) => (sum + +payment.amount), 0);
      const newTotalAmount = dto.payments.reduce((sum, payment) => (sum + +payment.amount), 0);
      if (totalPaid + newTotalAmount > (+order.totalAmount - +order.returnedAmount)) {
        throw new BadRequestException('Payment amount exceeds order total');
      }
      await this.prisma.$transaction(async (prisma) => {
        for (const paymentDto of dto.payments) {
          await prisma.payment.create({
            data: {
              orderId: dto.orderId,
              type: paymentDto.type,
              amount: paymentDto.amount,
              paidAt: paymentDto?.paidAt ?? null,
              createdBy: user.staff.id,
            },
          });
        }
        const status = totalPaid + newTotalAmount === +order.totalAmount - +order.returnedAmount
          ? OrderStatus.COMPLETED : OrderStatus.DEBT;
        const customer = dto.customerId ? await prisma.customer.findUnique({ where: { id: dto.customerId } }) : null;


        if (order.isReturned && status === OrderStatus.COMPLETED) {
          await prisma.order.update({
            where: { id: dto.orderId },
            data: {
              status: OrderStatus.REFUNDED,
              paidAmount: totalPaid + newTotalAmount,
              customerId: customer?.id ?? null,
            }
          });
          await prisma.returnedOrder.update({
            where: { orderId: dto.orderId },
            data: {
              status,
            }
          })
        } else {
          await prisma.order.update({
            where: { id: dto.orderId },
            data: {
              status,
              paidAmount: totalPaid + newTotalAmount,
              customerId: customer?.id ?? null,
            }
          });
        }
      })
      return { message: 'Payment(s) added successfully' };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createPaymentForReturnOrder(id: string, dto: CreateReturnPaymentDto, user: CurrentUser) {
    try {
      const returnOrder = await this.prisma.returnedOrder.findUnique({
        where: { id },
        include: { payments: true, items: true }
      });
      if (!returnOrder) {
        throw new BadRequestException('Returned order not found');
      }
      if (returnOrder.status !== ReturnOrderStatus.CREDIT) {
        throw new BadRequestException('Cannot add payment to a returned order that is not in CREDIT status');
      }
      const totalPaid = returnOrder.payments.reduce((sum, payment) => (sum + +payment.amount), 0);
      const newTotalAmount = dto.payments.reduce((sum, payment) => (sum + +payment.amount), 0);

      if (totalPaid + newTotalAmount > +returnOrder.totalAmount) {
        throw new BadRequestException('Payment amount exceeds returned order total');
      }

      await this.prisma.$transaction(async (prisma) => {
        await prisma.returnPayment.createMany({
          data: dto.payments.map(paymentDto => ({
            returnOrderId: returnOrder.id,
            type: paymentDto.type,
            amount: paymentDto.amount,
            createdBy: user.staff.id
          })
          )
        })

        const status = totalPaid + newTotalAmount === +returnOrder.totalAmount ? ReturnOrderStatus.COMPLETED : ReturnOrderStatus.CREDIT;
        await prisma.returnedOrder.update({
          where: { id: returnOrder.id },
          data: {
            status,
          }
        })
      });

    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAll({ currentPage, pageSize }: any, user: CurrentUser) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const params = {};
      if (user.staff.storeId) {
        params['storeId'] = user.staff.storeId;
      }

      const result = await this.prisma.payment.findMany({
        skip: skip,
        take: +pageSize,
        where: params
      });
      const count = await this.prisma.payment.count({
        where: params
      });
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
    return `This action returns a #${id} payment`;
  }

  update(id: string, updatePaymentDto: UpdatePaymentDto) {
    return `This action updates a #${id} payment`;
  }

  remove(id: string) {
    return `This action removes a #${id} payment`;
  }
}
