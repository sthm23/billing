import { BadRequestException, Injectable } from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CurrentUser } from '@auth/models/auth.model';
import { OrderStatus, PaymentType } from '@generated/enums';

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
      if (totalPaid + newTotalAmount > +order.totalAmount) {
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
        const status = totalPaid + newTotalAmount === +order.totalAmount ? OrderStatus.COMPLETED : OrderStatus.DEBT;
        const customer = dto.customerId ? await prisma.customer.findUnique({ where: { id: dto.customerId } }) : null;

        await prisma.order.update({
          where: { id: dto.orderId },
          data: {
            status,
            paidAmount: totalPaid + newTotalAmount,
            customerId: customer?.id ?? null,
          }
        });
      })
      return { message: 'Payment(s) added successfully' };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAll(pageSize = 10, currentPage = 1) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const result = await this.prisma.payment.findMany({
        skip: skip,
        take: +pageSize,
      });
      const count = await this.prisma.payment.count();
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
