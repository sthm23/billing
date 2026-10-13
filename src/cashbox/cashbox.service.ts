import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
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
    @InjectPinoLogger(CashboxService.name) private readonly logger: PinoLogger,
  ) { }

  async createCashBox(dto: CreateCashBoxDto, user: CurrentUser) {
    this.logger.debug({ storeId: dto.storeId, warehouseId: dto.warehouseId, sellerId: user.staff.id }, 'Opening cashbox');
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

      const param = {
        storeId: dto.storeId,
        status: CashStatus.OPEN
      }
      const isAdminOrOwner = user.role === UserRole.ADMIN || user.role === UserRole.OWNER
      if (!isAdminOrOwner) {
        param['warehouseId'] = dto.warehouseId
        param['sellerId'] = user.staff.id
      }
      const existingCashBox = await this.prisma.cashbox.findFirst({
        where: { ...param }
      })
      if (existingCashBox) {
        this.logger.warn({ storeId: dto.storeId, warehouseId: dto.warehouseId }, 'Open cashbox already exists');
        throw new BadRequestException('An OPEN cashbox already exists for this store and warehouse');
      }
      const cashbox = await this.prisma.cashbox.create({
        data: {
          storeId: dto.storeId,
          sellerId: user.staff.id,
          warehouseId: dto.warehouseId,
          balance: dto.balance ?? 0,
          status: CashStatus.OPEN
        }
      });
      this.logger.info({ cashboxId: cashbox.id, storeId: dto.storeId, sellerId: user.staff.id }, 'Cashbox opened');
      return cashbox;
    } catch (error: any) {
      this.logger.error({ storeId: dto.storeId, err: error.message }, 'Failed to open cashbox');
      throw new BadRequestException(error.response || error.message)
    }
  }

  async closeCashBox(id: string, user: CurrentUser) {
    this.logger.debug({ cashboxId: id, sellerId: user.staff.id }, 'Closing cashbox');
    try {
      const param = {
        id,
        status: CashStatus.OPEN,
        storeId: user.staff.storeId,
      }

      if (user.role !== UserRole.ADMIN && user.role !== UserRole.OWNER) {
        param['warehouseId'] = user.staff.warehouse[0]?.warehouseId
        param['sellerId'] = user.staff.id
      }

      const existingCashBox = await this.prisma.cashbox.findFirst({
        where: { ...param }
      })
      if (!existingCashBox) {
        throw new BadRequestException('No OPEN cashbox found for this store and warehouse');
      }
      const closed = await this.prisma.cashbox.update({
        where: { id: existingCashBox.id },
        data: {
          status: CashStatus.CLOSED
        }
      })
      this.logger.info({ cashboxId: existingCashBox.id, storeId: user.staff.storeId }, 'Cashbox closed');
      return closed;
    } catch (error: any) {
      this.logger.error({ cashboxId: id, err: error.message }, 'Failed to close cashbox');
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createCashTransaction(cashBoxId: string, dto: CreateCashTransactionDto, user: CurrentUser) {
    this.logger.debug({ cashboxId: cashBoxId, amount: dto.amount, type: dto.type, category: dto.category }, 'Creating cash transaction');
    try {
      const param = {
        id: cashBoxId,
        storeId: user.staff.storeId,
      }
      if (user.role !== UserRole.ADMIN && user.role !== UserRole.OWNER) {
        param['warehouseId'] = user.staff.warehouse[0]?.warehouseId
        param['sellerId'] = user.staff.id
      }
      const cashBox = await this.prisma.cashbox.findUnique({
        where: { ...param },
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
      this.logger.info({ cashboxId: cashBoxId, amount: dto.amount, type: dto.type }, 'Cash transaction created');
      return { message: 'Cash transaction added successfully' };
    } catch (error: any) {
      this.logger.error({ cashboxId: cashBoxId, err: error.message }, 'Failed to create cash transaction');
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
        paramsSchema['sellerId'] = user.staff.id
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
