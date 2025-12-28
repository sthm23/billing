import { StaffRole } from '@generated/enums';
import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '@shared/model/role.model';

export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);