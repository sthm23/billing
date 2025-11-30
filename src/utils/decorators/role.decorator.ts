import { ROLE } from '@generated/enums';
import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '@utils/model/role.model';

export const Roles = (...roles: ROLE[]) => SetMetadata(ROLES_KEY, roles);