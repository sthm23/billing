import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { fullPhoneVariants, UserService } from './user.service';

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
    $transaction: jest.fn(),
    order: { findUnique: jest.fn(), update: jest.fn() },
    customer: { findUnique: jest.fn(), create: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn(), count: jest.fn(), findMany: jest.fn() },
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

  describe('getCustomers', () => {
    beforeEach(() => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);
    });

    const ownCustomer = {
      customer: {
        OR: [
          { stores: { some: { id: STORE } } },
          { orders: { some: { storeId: STORE } } },
          { customerDebts: { some: { storeId: STORE } } },
        ],
      },
    };

    it('lists only the store customers without a search', async () => {
      await service.getCustomers(10, 1, undefined, makeUser());
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        type: UserType.CUSTOMER,
        AND: [ownCustomer],
      });
    });

    it('searches own customers by part of the name or phone', async () => {
      await service.getCustomers(10, 1, 'али', makeUser());
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual(ownCustomer);
      expect(JSON.stringify(where)).not.toContain('"in"');
    });

    it('finds a customer of another store only by the full phone number', async () => {
      await service.getCustomers(10, 1, '90 123 45 67', makeUser());
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({
        OR: [
          ownCustomer,
          { phone: { in: ['901234567', '998901234567', '+998901234567'] } },
        ],
      });
    });

    it('lets an admin search everyone', async () => {
      await service.getCustomers(10, 1, '', {
        role: UserRole.ADMIN,
        staff: null,
      } as never);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        type: UserType.CUSTOMER,
      });
    });
  });

  describe('createCustomers', () => {
    it('links a new customer to the creating store', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
      prisma.user.create.mockResolvedValue({ id: 'u1', fullName: 'Алиев', phone: '+998901234567' });
      prisma.customer.create.mockResolvedValue({ id: CUSTOMER });
      await service.createCustomers(
        { fullName: 'Алиев', phone: '+998901234567' } as never,
        makeUser(),
      );
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: { userId: 'u1', stores: { connect: { id: STORE } } },
      });
    });

    it('rejects an existing phone and hints to search by the full number', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      await expect(
        service.createCustomers({ fullName: 'X', phone: '+998901234567' } as never, makeUser()),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('fullPhoneVariants', () => {
    it('recognises a full number in any common format', () => {
      expect(fullPhoneVariants('+998 90 123-45-67')).toEqual(['901234567', '998901234567', '+998901234567']);
      expect(fullPhoneVariants('901234')).toBeNull();
    });
  });
});
