import { ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '@auth/models/auth.model';
import { StaffRole, UserRole } from '@generated/enums';

/**
 * Admin, owner or manager: may see purchase cost (`unitCost`, `costAtSale`) —
 * the same roles that enter it. Seller, cashier and warehouse staff get null.
 */
export function canSeeCost(user: CurrentUser): boolean {
  return (
    user.role === UserRole.ADMIN ||
    user.role === UserRole.OWNER ||
    user.staff?.role === StaffRole.OWNER ||
    user.staff?.role === StaffRole.MANAGER
  );
}

/** Store owner (or platform admin): every warehouse and cashbox of the store. */
export function isStoreOwner(user: CurrentUser): boolean {
  return (
    user.role === UserRole.ADMIN ||
    user.role === UserRole.OWNER ||
    user.staff?.role === StaffRole.OWNER
  );
}

/**
 * May open an own cashbox: owner, manager, cashier. A seller (and warehouse
 * staff) works with an open cashbox of their warehouse instead.
 */
export function canOpenCashbox(user: CurrentUser): boolean {
  return (
    isStoreOwner(user) ||
    user.staff?.role === StaffRole.MANAGER ||
    user.staff?.role === StaffRole.CASHIER
  );
}

/** The employee's warehouses (owner: `null` — every warehouse of the store). */
export function staffWarehouseIds(user: CurrentUser): string[] | null {
  if (isStoreOwner(user)) return null;
  return (user.staff?.warehouse ?? []).map((w) => w.warehouseId);
}

/** Store owner or manager — may process returns and pay out refunds. */
export function canProcessReturns(user: CurrentUser): boolean {
  return (
    user.role === UserRole.OWNER ||
    user.staff?.role === StaffRole.OWNER ||
    user.staff?.role === StaffRole.MANAGER
  );
}

/**
 * Returns and refund payouts: store owner (any warehouse) or a manager of the
 * order's warehouse. The store itself is checked by the caller.
 */
export function assertReturnAccess(
  user: CurrentUser,
  warehouseId: string,
): void {
  if (!user.staff || !canProcessReturns(user)) {
    throw new ForbiddenException(
      'Only the owner or a manager can process returns',
    );
  }
  const isOwner =
    user.role === UserRole.OWNER || user.staff.role === StaffRole.OWNER;
  if (
    !isOwner &&
    !user.staff.warehouse.some((w) => w.warehouseId === warehouseId)
  ) {
    throw new ForbiddenException('No access to this warehouse');
  }
}
