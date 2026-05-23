import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateDebtDto, CreateDebtPaymentDto } from './dto/create-debt.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CashStatus, CashTransactionCategory, CashTransactionType, DebtStatus } from '@generated/enums';
import { CurrentUser } from '@auth/models/auth.model';
import { OrderQueryParams } from '@order/entities/order.entity';
import { DebtQueryParams } from './dto/param.dto';

@Injectable()
export class DebtService {

  constructor(
    private readonly prisma: PrismaService,
  ) { }

  async createCustomerDebt(dto: CreateDebtDto, user: CurrentUser) {
    try {
      if (user.staff && user.staff.storeId !== dto.storeId) {
        throw new BadRequestException('Wrong StoreId given!')
      }

      return await this.prisma.customerDebt.create({
        data: {
          storeId: dto.storeId,
          customerId: dto.customerId,
          description: dto.description ?? null,
          totalAmount: dto.amount,
          paidAmount: 0,
          status: DebtStatus.ACTIVE,
          createdAt: dto.createdAt ?? new Date(),
          returnedAt: dto.returnedAt ?? new Date(),
        }
      });
    } catch (err: any) {
      throw new BadRequestException(err.response || err.message)
    }
  }

  async createDebtPayment(dto: CreateDebtPaymentDto, user: CurrentUser) {
    const debt = await this.prisma.customerDebt.findUnique({ where: { id: dto.debtId } });
    if (!debt) {
      throw new BadRequestException('Долг не найден');
    }
    const cashBox = await this.prisma.cashbox.findFirst({
      where: { warehouseId: dto.warehouseId, storeId: debt.storeId, sellerId: user.staff.id, status: CashStatus.OPEN },
    });
    if (!cashBox) {
      throw new BadRequestException('Касса не найдена для данного склада');
    }
    if (!user.staff.warehouse.find(w => w.warehouseId === dto.warehouseId)) {
      throw new BadRequestException('У пользователя нет доступа к данному складу');
    }
    try {
      return await this.prisma.$transaction(async (prisma) => {
        const debtPaymentData = dto.payments.map(payment => ({
          debtId: debt.id,
          amount: payment.amount,
          type: payment.type,
          createdBy: user.staff.id,
        }));
        const debtPayments = await prisma.debtPayment.createManyAndReturn({
          data: debtPaymentData
        })


        // 2. Создаём CashTransaction — ТОЧНО КАК ДЛЯ ЗАКАЗОВ
        const cashTransactions = dto.payments.map(payment => {

          const debtPayment = debtPayments.find(dp => +dp.amount === payment.amount && dp.type === payment.type && dp.createdBy === user.staff.id)!;
          return {

            cashboxId: cashBox.id,
            amount: payment.amount,
            type: CashTransactionType.INCOME,
            category: CashTransactionCategory.DEBT_PAYMENT,
            paymentType: payment.type,
            createdById: user.staff.id,
            debtId: debtPayment ? debtPayment.id : '' // связываем платеж с транзакцией
          }
        })
        await prisma.cashTransaction.createMany({
          data: cashTransactions
        });

        const totalPaymentAmount = dto.payments.reduce((sum, payment) => sum + +payment.amount, 0);
        // 3. Обновляем баланс кассы
        await prisma.cashbox.update({
          where: { id: cashBox.id },
          data: {
            balance: {
              increment: totalPaymentAmount
            }
          }
        });

        const newPaidAmount = +debt.paidAmount + totalPaymentAmount;
        const newStatus = newPaidAmount >= +debt.totalAmount ? DebtStatus.PAID : DebtStatus.ACTIVE;

        // 4. Обновляем paidAmount и статус долга
        return await prisma.customerDebt.update({
          where: { id: debt.id },
          data: {
            paidAmount: { increment: totalPaymentAmount },
            status: newStatus
          }
        });
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findAll({ pageSize = 10, currentPage = 1, status, customerId, fromDate, toDate }: DebtQueryParams, user: CurrentUser) {
    try {

      const where = {
        storeId: user.staff.storeId,
      };
      if (status) {
        where['status'] = status;
      }
      if (customerId) {
        where['customerId'] = customerId;
      }
      if (fromDate || toDate) {
        where['createdAt'] = {};
        if (fromDate) {
          where['createdAt'].gte = new Date(fromDate);
        }
        if (toDate) {
          where['createdAt'].lte = new Date(toDate);
        }
      }

      const result = await this.prisma.customerDebt.findMany({
        where,
        include: {
          customer: {
            include: {
              user: true
            }
          },
          payments: true
        }
      })
      const total = await this.prisma.customerDebt.count({ where });
      return { data: result, total, currentPage: +currentPage, pageSize: +pageSize };

    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findOne(id: string) {
    try {
      const debt = await this.prisma.customerDebt.findUnique({
        where: { id },
        include: {
          customer: {
            include: {
              user: true
            }
          },
          payments: true
        }
      });
      return debt;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }
}
