import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCashBoxDto, CreateCashTransactionDto } from './dto/create-cashbox.dto';
import { PrismaService } from '@prisma/prisma.service';
import { CashStatus, CashTransactionType, PaymentType, UserRole } from '@generated/enums';
import { CurrentUser } from '@auth/models/auth.model';
import { Prisma } from '@generated/client';
import { CashboxWhereUniqueInput } from '@generated/internal/prismaNamespace';

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
          warehouseId: user.staff.warehouse[0]?.warehouseId,
          status: CashStatus.OPEN
        }
      })
      if (existingCashBox) {
        if (dto.status === CashStatus.OPEN) {
          if (existingCashBox.status === CashStatus.CLOSED) {
            throw new BadRequestException('Cannot open a new cashbox while there is an open cashbox')
          }
          return existingCashBox
        } else {
          if (existingCashBox.status === CashStatus.CLOSED) {
            throw new BadRequestException('Cashbox is already closed')
          }
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

  async findAll(params: any, user: CurrentUser) {
    try {
      const { currentPage = 1, pageSize = 10 } = params
      const skip = (currentPage - 1) * pageSize;
      const paramsSchema = {}
      if (user.staff.storeId) {
        paramsSchema['storeId'] = user.staff.storeId
      }
      const isAdminOrOwner = user.role === UserRole.ADMIN || user.role === UserRole.OWNER
      if (!isAdminOrOwner) {
        if (user.staff.warehouse[0]?.warehouseId) {
          paramsSchema['warehouseId'] = user.staff.warehouse[0].warehouseId
        }
      }
      const totalItems = await this.prisma.cashbox.count({
        where: paramsSchema
      })
      const cashboxes = await this.prisma.cashbox.findMany({
        where: paramsSchema,
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' }
          },
          seller: {
            include: {
              user: true
            }
          },
          warehouse: true
        },
        skip: skip,
        take: +pageSize,
        orderBy: { createdAt: 'desc' },
      });
      return { data: cashboxes, total: totalItems, currentPage, pageSize };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findOne(id: string, user: CurrentUser) {
    try {

      const paramsSchema: CashboxWhereUniqueInput = {
        id
      }

      if (user.staff.storeId) {
        paramsSchema['storeId'] = user.staff.storeId
      }
      const isAdminOrOwner = user.role === UserRole.ADMIN || user.role === UserRole.OWNER
      if (!isAdminOrOwner) {
        if (user.staff.warehouse[0]?.warehouseId) {
          paramsSchema['warehouseId'] = user.staff.warehouse[0].warehouseId
        }
      }
      const cashbox = await this.prisma.cashbox.findUnique({
        where: { ...paramsSchema },
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' }
          },
          seller: {
            include: {
              user: true
            }
          },
          warehouse: true
        }
      });
      if (!cashbox) {
        throw new BadRequestException('Cashbox not found');
      }
      return cashbox;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}
