import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCashBoxDto, CreateCashTransactionDto } from './dto/create-cashbox.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CashStatus, CashTransactionType, PaymentType } from '@generated/enums';
import { CurrentUser } from '@auth/models/auth.model';
import { Prisma } from '@generated/client';

@Injectable()
export class CashboxService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }
  async createCashBox(dto: CreateCashBoxDto, user: CurrentUser) {
    try {
      const existingCashBox = await this.prisma.cashbox.findFirst({
        where: {
          storeId: user.staff.storeId,
          sellerId: user.staff.id,
          status: CashStatus.OPEN
        }
      })
      if (existingCashBox) {
        if (dto.status === CashStatus.OPEN) {
          return existingCashBox
        } else {
          return await this.prisma.cashbox.update({
            where: { id: existingCashBox.id },
            data: {
              status: dto.status
            }
          })
        }
      }
      return await this.prisma.cashbox.create({
        data: {
          storeId: user.staff.storeId,
          sellerId: user.staff.id,
          warehouseId: user.staff.warehouse[0].warehouseId,
          balance: dto.balance ?? 0,
          status: dto.status ?? CashStatus.OPEN
        }
      });


    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createCashTransaction(cashBoxId: string, dto: CreateCashTransactionDto, user: CurrentUser) {
    try {
      const cashBox = await this.prisma.cashbox.findUnique({
        where: { id: cashBoxId }
      })
      if (!cashBox) {
        throw new BadRequestException('Cashbox not found');
      }
      if (cashBox.status !== CashStatus.OPEN) {
        throw new BadRequestException('Cannot add transaction to a cashbox that is not OPEN');
      }
      await this.prisma.$transaction(async (prisma) => {
        await prisma.cashTransaction.create({
          data: {
            cashboxId: cashBox.id,
            amount: dto.amount,
            type: dto.type,
            createdById: user.staff.id,
            category: dto.category,
            comment: dto.comment,
            paymentType: dto.paymentType as PaymentType
          }
        })
        await prisma.cashbox.update({
          where: { id: cashBox.id },
          data: {
            balance: { increment: dto.type === CashTransactionType.INCOME ? new Prisma.Decimal(dto.amount) : new Prisma.Decimal(-dto.amount) }
          }
        })
      })
      return { message: 'Cash transaction added successfully' };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  findAll(params: any, user: CurrentUser) {
    return `This action returns all cashbox`;
  }

  findOne(id: string) {
    return `This action returns a #${id} cashbox`;
  }
}
