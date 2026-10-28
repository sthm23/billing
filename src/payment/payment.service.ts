import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { resolvePaymentCashbox } from 'src/cashbox/payment-cashbox';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CreatePaymentDto, CreateReturnPaymentDto } from './dto/create-payment.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CurrentUser } from '@auth/models/auth.model';
import {
  CashStatus, CashTransactionCategory, CashTransactionType,
  OrderStatus, PaymentType, ReturnOrderStatus
} from '@generated/enums';
import { Prisma } from '@generated/client';

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(PaymentService.name) private readonly logger: PinoLogger,
  ) { }

  async create(dto: CreatePaymentDto, user: CurrentUser) {
    this.logger.debug({ orderId: dto.orderId }, 'Processing debt payment');
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        include: { payments: true }
      });
      if (!order) {
        throw new BadRequestException('Order not found');
      }
      if (!user.staff || order.storeId !== user.staff.storeId) {
        throw new ForbiddenException('No access to this order');
      }
      if (order.status !== 'DEBT') {
        throw new BadRequestException('Cannot add payment to an order that is not in DEBT status');
      }
      const totalPaid = order.payments.reduce((sum, payment) => (sum + +payment.amount), 0);
      const newTotalAmount = dto.payments.reduce((sum, payment) => (sum + +payment.amount), 0);
      if (totalPaid + newTotalAmount > (+order.totalAmount - +order.returnedAmount)) {
        throw new BadRequestException('Payment amount exceeds order total');
      }
      // Any employee of the store: own open cashbox or the chosen open one
      const cashBox = await resolvePaymentCashbox(this.prisma, user, {
        cashboxId: dto.cashboxId,
        warehouseId: order.warehouseId,
      });
      // Omitted customerId keeps the order's customer
      const customer = dto.customerId
        ? await this.prisma.customer.findUnique({ where: { id: dto.customerId } })
        : null;
      if (dto.customerId && !customer) {
        throw new BadRequestException('Customer not found');
      }
      const customerId = customer?.id ?? order.customerId;
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
        await prisma.cashTransaction.createMany({
          data: dto.payments.map(p => ({
            cashboxId: cashBox.id,
            amount: p.amount,
            type: CashTransactionType.INCOME,
            createdById: user.staff.id,
            orderId: dto.orderId,
            // A repayment, not a sale: counted in «Погашено» of the debtors screen
            category: CashTransactionCategory.DEBT_PAYMENT,
            paymentType: p.type as PaymentType
          }))
        })
        const status = totalPaid + newTotalAmount === +order.totalAmount - +order.returnedAmount
          ? OrderStatus.COMPLETED : OrderStatus.DEBT;

        await prisma.cashbox.update({
          where: { id: cashBox.id },
          data: {
            balance: { increment: new Prisma.Decimal(newTotalAmount) }
          }
        })

        if (order.isReturned && status === OrderStatus.COMPLETED) {
          await prisma.order.update({
            where: { id: dto.orderId },
            data: {
              status: OrderStatus.REFUNDED,
              paidAmount: totalPaid + newTotalAmount,
              customerId,
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
              customerId,
            }
          });
        }
      })
      const finalStatus = totalPaid + newTotalAmount === +order.totalAmount - +order.returnedAmount ? OrderStatus.COMPLETED : OrderStatus.DEBT;
      this.logger.info({ orderId: dto.orderId, amount: newTotalAmount, finalStatus }, 'Debt payment processed');
      return { message: 'Payment(s) added successfully' };
    } catch (error: any) {
      this.logger.error({ orderId: dto.orderId, err: error.message }, 'Failed to process debt payment');
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createPaymentForReturnOrder(id: string, dto: CreateReturnPaymentDto, user: CurrentUser) {
    this.logger.debug({ returnOrderId: id }, 'Processing return payout');
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

      const cashBox = await this.prisma.cashbox.findFirst({
        where: {
          storeId: user.staff.storeId,
          sellerId: user.staff.id,
          status: CashStatus.OPEN
        }
      });

      if (!cashBox) {
        throw new BadRequestException('Open cashbox not found for the returned order store');
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

        await prisma.cashTransaction.createMany({
          data: dto.payments.map(paymentDto => ({
            cashboxId: cashBox.id,
            amount: paymentDto.amount,
            type: CashTransactionType.EXPENSE,
            createdById: user.staff.id,
            orderId: returnOrder.id,
            category: CashTransactionCategory.RETURN,
            paymentType: paymentDto.type as PaymentType
          }))
        })

        const status = totalPaid + newTotalAmount === +returnOrder.totalAmount ? ReturnOrderStatus.COMPLETED : ReturnOrderStatus.CREDIT;
        await prisma.returnedOrder.update({
          where: { id: returnOrder.id },
          data: {
            status,
          }
        })

        await prisma.cashbox.update({
          where: { id: cashBox.id },
          data: {
            balance: { increment: new Prisma.Decimal(-newTotalAmount) }
          }
        })
      });

      const finalStatus = totalPaid + newTotalAmount === +returnOrder.totalAmount ? ReturnOrderStatus.COMPLETED : ReturnOrderStatus.CREDIT;
      this.logger.info({ returnOrderId: id, amount: newTotalAmount, finalStatus }, 'Return payout processed');
    } catch (error: any) {
      this.logger.error({ returnOrderId: id, err: error.message }, 'Failed to process return payout');
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
    return this.prisma.payment.findUnique({
      where: { id },
      include: {
        order: true,
        cashier: {
          include: {
            user: true
          }
        }
      }
    });
  }
}
