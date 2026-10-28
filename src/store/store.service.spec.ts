import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { HashingHelper } from '@shared/helper/hash.helper';
import type { CurrentUser } from '@auth/models/auth.model';
import { CreateStaffDto } from './dto/create-store.dto';
import { StoreService } from './store.service';

const OWN_STORE = '11111111-1111-4111-8111-111111111111';
const FOREIGN_STORE = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';

function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 'owner-user',
    role: UserRole.OWNER,
    type: UserType.STAFF,
    staff: {
      id: 'owner-staff',
      storeId: OWN_STORE,
      role: StaffRole.OWNER,
      warehouse: [],
    },
    ...overrides,
  } as unknown as CurrentUser;
}

function makeDto(overrides: Partial<CreateStaffDto> = {}): CreateStaffDto {
  return Object.assign(new CreateStaffDto(), {
    fullName: 'Алиев Камол',
    phone: '+998901234567',
    login: 'kamol',
    password: 'secret123',
    role: StaffRole.SELLER,
    storeId: OWN_STORE,
    warehouseId: WAREHOUSE,
    ...overrides,
  });
}

describe('StoreService', () => {
  let service: StoreService;
  const prisma = {
    warehouse: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn() },
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(HashingHelper, 'hash').mockResolvedValue('hashed');
    prisma.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-user' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(StoreService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<StoreService>(StoreService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createStaff', () => {
    it('creates staff in the owner store taken from the token', async () => {
      await service.createStaff(makeDto(), makeUser());

      expect(prisma.warehouse.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: WAREHOUSE, storeId: OWN_STORE },
        }),
      );
      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.staff.create.storeId).toBe(OWN_STORE);
      expect(createArgs.data.staff.create.role).toBe(StaffRole.SELLER);
    });

    it('rejects a storeId of another store', async () => {
      await expect(
        service.createStaff(makeDto({ storeId: FOREIGN_STORE }), makeUser()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a warehouse that does not belong to the store', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.createStaff(makeDto(), makeUser()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('does not let an owner create another owner', async () => {
      await expect(
        service.createStaff(makeDto({ role: StaffRole.OWNER }), makeUser()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a user without a store', async () => {
      await expect(
        service.createStaff(
          makeDto(),
          makeUser({ staff: null } as unknown as Partial<CurrentUser>),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('lets an admin create staff in the requested store', async () => {
      const admin = makeUser({
        role: UserRole.ADMIN,
        staff: null,
      } as unknown as Partial<CurrentUser>);

      await service.createStaff(makeDto({ storeId: FOREIGN_STORE }), admin);

      expect(prisma.warehouse.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: WAREHOUSE, storeId: FOREIGN_STORE },
        }),
      );
      expect(
        prisma.user.create.mock.calls[0][0].data.staff.create.storeId,
      ).toBe(FOREIGN_STORE);
    });

    it('never returns the password hash', async () => {
      await service.createStaff(makeDto(), makeUser());

      const include = prisma.user.create.mock.calls[0][0].include;
      expect(include.auth).toEqual({
        select: expect.not.objectContaining({ passwordHash: true }),
      });
    });
  });
});
