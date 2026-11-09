import { ForbiddenException } from '@nestjs/common';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import type { CurrentUser } from '@auth/models/auth.model';
import type { PrismaService } from '@prisma/prisma.service';
import { assertWarehouseAccess } from './warehouse-access.helper';

const STORE = '11111111-1111-4111-8111-111111111111';
const OWN = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

function makeUser(staffRole: StaffRole): CurrentUser {
  return {
    id: 'user',
    role: staffRole === StaffRole.OWNER ? UserRole.OWNER : UserRole.USER,
    type: UserType.STAFF,
    staff: {
      id: 'staff',
      storeId: STORE,
      role: staffRole,
      warehouse: [{ warehouseId: OWN }],
    },
  } as unknown as CurrentUser;
}

describe('assertWarehouseAccess', () => {
  const prisma = { warehouse: { findFirst: jest.fn() } };
  const db = prisma as unknown as PrismaService;

  beforeEach(() => jest.clearAllMocks());

  it('lets an employee use an assigned warehouse without a query', async () => {
    await expect(
      assertWarehouseAccess(db, makeUser(StaffRole.SELLER), OWN),
    ).resolves.toBeUndefined();
    expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a warehouse the employee is not assigned to', async () => {
    await expect(
      assertWarehouseAccess(db, makeUser(StaffRole.MANAGER), OTHER),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets the owner use any warehouse of the store', async () => {
    prisma.warehouse.findFirst.mockResolvedValue({ id: OTHER });

    await assertWarehouseAccess(db, makeUser(StaffRole.OWNER), OTHER);

    expect(prisma.warehouse.findFirst).toHaveBeenCalledWith({
      where: { id: OTHER, storeId: STORE },
      select: { id: true },
    });
  });

  it("rejects the owner on another store's warehouse", async () => {
    prisma.warehouse.findFirst.mockResolvedValue(null);

    await expect(
      assertWarehouseAccess(db, makeUser(StaffRole.OWNER), OTHER),
    ).rejects.toThrow(ForbiddenException);
  });
});
