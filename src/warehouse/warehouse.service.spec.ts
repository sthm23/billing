import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import {
  StaffRole,
  StockMovementReason,
  StockMovementType,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { InventoryMovementDto } from './dto/create-warehouse.dto';
import { WarehouseService } from './warehouse.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const VARIANT = '55555555-5555-4555-8555-555555555555';

function makeUser(
  staffRole: StaffRole = StaffRole.MANAGER,
  overrides: Partial<CurrentUser['staff']> = {},
): CurrentUser {
  return {
    id: 'user',
    role: staffRole === StaffRole.OWNER ? UserRole.OWNER : UserRole.USER,
    type: UserType.STAFF,
    staff: {
      id: 'staff',
      storeId: STORE,
      role: staffRole,
      warehouse: [{ warehouseId: WAREHOUSE }],
      ...overrides,
    },
  } as unknown as CurrentUser;
}

function movement(dto: Partial<InventoryMovementDto>): InventoryMovementDto {
  return {
    variantId: VARIANT,
    quantity: 3,
    type: StockMovementType.IN,
    reason: StockMovementReason.PURCHASE,
    costPrice: 50000,
    ...dto,
  } as InventoryMovementDto;
}

describe('WarehouseService', () => {
  let service: WarehouseService;
  const prisma = {
    $transaction: jest.fn(),
    productVariant: { findUnique: jest.fn(), update: jest.fn() },
    warehouse: { findUnique: jest.fn() },
    inventory: { upsert: jest.fn(), updateMany: jest.fn() },
    stockMovement: { create: jest.fn() },
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma),
    );
    prisma.productVariant.findUnique.mockResolvedValue({
      id: VARIANT,
      warehouseId: WAREHOUSE,
    });
    prisma.warehouse.findUnique.mockResolvedValue({
      id: WAREHOUSE,
      storeId: STORE,
    });
    prisma.inventory.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehouseService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(WarehouseService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<WarehouseService>(WarehouseService);
  });

  describe('inventoryMovement', () => {
    it('records a purchase and keeps the price when none is given', async () => {
      await service.inventoryMovement(WAREHOUSE, movement({}), makeUser());
      expect(prisma.inventory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantity: { increment: 3 } } }),
      );
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: StockMovementType.IN,
          reason: StockMovementReason.PURCHASE,
          quantity: 3,
          createdById: 'staff',
        }),
      });
      expect(prisma.productVariant.update).not.toHaveBeenCalled();
    });

    it('updates the sale price when given', async () => {
      await service.inventoryMovement(
        WAREHOUSE,
        movement({ price: 90000 }),
        makeUser(),
      );
      expect(prisma.productVariant.update).toHaveBeenCalledTimes(1);
    });

    it('writes off without a cost and never below zero', async () => {
      const dto = movement({
        type: StockMovementType.OUT,
        reason: StockMovementReason.ADJUSTMENT,
        costPrice: undefined,
      });
      await service.inventoryMovement(WAREHOUSE, dto, makeUser());
      expect(prisma.inventory.updateMany).toHaveBeenCalledWith({
        where: {
          warehouseId: WAREHOUSE,
          variantId: VARIANT,
          quantity: { gte: 3 },
        },
        data: { quantity: { decrement: 3 } },
      });
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unitCost: null }),
      });

      prisma.inventory.updateMany.mockResolvedValue({ count: 0 });
      prisma.stockMovement.create.mockClear();
      await expect(
        service.inventoryMovement(WAREHOUSE, dto, makeUser()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('rejects a purchase without a cost and sale/return movements', async () => {
      await expect(
        service.inventoryMovement(
          WAREHOUSE,
          movement({ costPrice: undefined }),
          makeUser(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.inventoryMovement(
          WAREHOUSE,
          movement({
            type: StockMovementType.OUT,
            reason: StockMovementReason.SALE,
          }),
          makeUser(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a warehouse of another store', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({
        id: WAREHOUSE,
        storeId: 'foreign-store',
      });
      await expect(
        service.inventoryMovement(WAREHOUSE, movement({}), makeUser()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('rejects a manager outside the warehouse but lets the owner in', async () => {
      await expect(
        service.inventoryMovement(
          WAREHOUSE,
          movement({}),
          makeUser(StaffRole.MANAGER, { warehouse: [] }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.inventoryMovement(
          WAREHOUSE,
          movement({}),
          makeUser(StaffRole.OWNER, { warehouse: [] }),
        ),
      ).resolves.toBeDefined();
    });
  });
});
