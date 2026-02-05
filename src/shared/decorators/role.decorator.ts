import { StaffRole as StaffRoleType, UserRole } from '@generated/enums';
import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '@shared/model/role.model';

export const Roles = (...roles: (UserRole | StaffRoleType)[]) => SetMetadata(ROLES_KEY, roles);