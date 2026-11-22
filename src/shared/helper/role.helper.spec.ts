import { StaffRole, UserRole } from '@generated/enums';
import type { CurrentUser } from '@auth/models/auth.model';
import { canSeeCost } from './role.helper';

const user = (role: UserRole, staffRole?: StaffRole) =>
  ({
    role,
    staff: staffRole ? { role: staffRole } : null,
  }) as unknown as CurrentUser;

describe('canSeeCost', () => {
  it.each([
    [UserRole.ADMIN, undefined],
    [UserRole.OWNER, StaffRole.OWNER],
    [UserRole.USER, StaffRole.MANAGER],
  ])('allows %s / %s', (role, staffRole) => {
    expect(canSeeCost(user(role, staffRole))).toBe(true);
  });

  it.each([StaffRole.SELLER, StaffRole.CASHIER, StaffRole.WAREHOUSE])(
    'hides the cost from %s',
    (staffRole) => {
      expect(canSeeCost(user(UserRole.USER, staffRole))).toBe(false);
    },
  );
});
