import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { UserService } from './user.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const FOREIGN_STORE = '22222222-2222-4222-8222-222222222222';
const ORDER = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '77777777-7777-4777-8777-777777777777';

function makeUser(): CurrentUser {
  return {
    id: 'user',
    role: UserRole.USER,
    type: UserType.STAFF,
    staff: {
      id: 'staff',
      storeId: STORE,
      role: StaffRole.SELLER,
      warehouse: [],
    },
  } as unknown as CurrentUser;
}

describe('UserService', () => {
  let service: UserService;
  const prisma = {
    order: { findUnique: jest.fn(), update: jest.fn() },
    customer: { findUnique: jest.fn() },
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(UserService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('setCustomerToOrder', () => {
    it('attaches a customer to an order of the user store', async () => {
      prisma.order.findUnique.mockResolvedValue({ storeId: STORE });
      await service.setCustomerToOrder(
        { orderId: ORDER, customerId: CUSTOMER },
        makeUser(),
      );
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: ORDER },
        data: { customerId: CUSTOMER },
      });
    });

    it('rejects an order of another store', async () => {
      prisma.order.findUnique.mockResolvedValue({ storeId: FOREIGN_STORE });
      await expect(
        service.setCustomerToOrder(
          { orderId: ORDER, customerId: CUSTOMER },
          makeUser(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });
});
