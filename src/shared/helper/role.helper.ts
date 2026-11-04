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
