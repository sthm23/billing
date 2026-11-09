import { ForbiddenException } from '@nestjs/common';
import { StaffRole, UserRole } from '@generated/enums';
import type { CurrentUser } from '@auth/models/auth.model';
import type { PrismaService } from '@prisma/prisma.service';

/**
 * A list filtered by `warehouseId` (the app's working warehouse): the
 * warehouse must belong to the user's store, and a non-owner must have it in
 * StaffOnWarehouse. Admins may pick any warehouse. Throws 403 otherwise.
 * Call it before a `try` that wraps errors into 400.
 */
export async function assertWarehouseAccess(
  prisma: PrismaService,
  user: CurrentUser,
  warehouseId: string,
): Promise<void> {
  if (user.role === UserRole.ADMIN) return;
  if (!user.staff) throw new ForbiddenException('Staff only');

  const isOwner =
    user.role === UserRole.OWNER || user.staff.role === StaffRole.OWNER;
  if (!isOwner) {
    // Access rows exist only for warehouses of the employee's store
    if (!user.staff.warehouse.some((w) => w.warehouseId === warehouseId)) {
      throw new ForbiddenException('No access to this warehouse');
    }
    return;
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, storeId: user.staff.storeId },
    select: { id: true },
  });
  if (!warehouse) {
    throw new ForbiddenException('No access to this warehouse');
  }
}
