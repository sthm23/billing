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
      const store = await this.prisma.store.findFirst({
        where: {
          id: dto.storeId,
        },
        include: {
          warehouse: true
        }
      })
      if (!store) {
        throw new BadRequestException('Store not found');
      }

      if (store.warehouse && store.warehouse.length > 0 && !store.warehouse.find(w => w.id === dto.warehouseId)) {
        throw new BadRequestException('Warehouse does not belong to the store');
      }

      const existingCashBox = await this.prisma.cashbox.findFirst({
        where: {
          storeId: dto.storeId,
          warehouseId: dto.warehouseId,
          status: CashStatus.OPEN
        }
      })
      if (existingCashBox) {
        throw new BadRequestException('An OPEN cashbox already exists for this store and warehouse');
      }
      return await this.prisma.cashbox.create({
        data: {
          storeId: dto.storeId,
          sellerId: user.staff.id,
          warehouseId: dto.warehouseId,
          balance: dto.balance ?? 0,
          status: CashStatus.OPEN
        }
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async closeCashBox(id: string) {
    try {
      const existingCashBox = await this.prisma.cashbox.findFirst({
        where: { id, status: CashStatus.OPEN }
      })
      if (!existingCashBox) {
        throw new BadRequestException('No OPEN cashbox found for this store and warehouse');
      }
      return await this.prisma.cashbox.update({
        where: { id: existingCashBox.id },
        data: {
          status: CashStatus.CLOSED
        }
      })
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
            paymentType: dto.paymentType as PaymentType,
            orderId: dto.orderId ?? null
          }
        })
        const balance = dto.type === CashTransactionType.INCOME ? { increment: new Prisma.Decimal(dto.amount) } : { decrement: new Prisma.Decimal(dto.amount) }
        await prisma.cashbox.update({
          where: { id: cashBox.id },
          data: {
            balance,
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
