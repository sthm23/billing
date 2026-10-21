import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { BarcodeService } from '@shared/helper/bar-code.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { ProductService } from './product.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const FOREIGN_WAREHOUSE = '99999999-9999-4999-8999-999999999999';

function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 'user',
    role: UserRole.USER,
    type: UserType.STAFF,
    staff: {
      id: 'staff',
      storeId: STORE,
      role: StaffRole.SELLER,
      warehouse: [{ warehouseId: WAREHOUSE }],
    },
    ...overrides,
  } as unknown as CurrentUser;
}

describe('ProductService', () => {
  let service: ProductService;
  const prisma = {
    productVariant: { count: jest.fn(), findMany: jest.fn() },
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.productVariant.count.mockResolvedValue(1);
    prisma.productVariant.findMany.mockResolvedValue([
      {
        id: 'variant',
        barCode: '2000000000017',
        price: 120000,
        sku: 'BEAM-6-11X25',
        product: { id: 'product', name: 'Половой брус 6м' },
        attributes: [
          {
            value: {
              attribute: { name: 'Размер' },
              valueString: '11×25',
              valueNumber: null,
              valueBool: null,
            },
          },
        ],
        inventory: [{ quantity: 34 }],
        stockMovements: [],
      },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: prisma },
        { provide: BarcodeService, useValue: {} },
        { provide: getLoggerToken(ProductService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  describe('search', () => {
    it('searches only the staff warehouse of the staff store and returns the product name', async () => {
      const res = await service.search(20, 1, 'брус', WAREHOUSE, makeUser());
      const where = prisma.productVariant.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ warehouseId: WAREHOUSE, storeId: STORE });
      expect(prisma.productVariant.count.mock.calls[0][0].where).toBe(where);
      expect(res.data[0]).toMatchObject({
        productName: 'Половой брус 6м',
        attributes: [{ name: 'Размер', value: '11×25' }],
        quantity: 34,
      });
    });

    it('rejects a warehouse the staff has no access to', async () => {
      await expect(
        service.search(20, 1, 'брус', FOREIGN_WAREHOUSE, makeUser()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    });

    it('lets an admin search any warehouse', async () => {
      await service.search(
        20,
        1,
        'брус',
        FOREIGN_WAREHOUSE,
        makeUser({ role: UserRole.ADMIN, staff: null } as never),
      );
      expect(
        prisma.productVariant.findMany.mock.calls[0][0].where,
      ).toMatchObject({ warehouseId: FOREIGN_WAREHOUSE });
      expect(
        prisma.productVariant.findMany.mock.calls[0][0].where.storeId,
      ).toBeUndefined();
    });
  });
});
