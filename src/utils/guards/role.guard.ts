import { UserAuth } from '@auth/models/auth.model';
import { Admin, Staff, User } from '@generated/client';
import { StaffRole, UserType } from '@generated/enums';
import { Injectable, CanActivate, ExecutionContext, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@utils/model/role.model';



@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {

        const requiredRoles = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass()
        ])

        if (!requiredRoles) {
            return true;
        }
        const user = context.switchToHttp().getRequest().user as UserAuth & { staff: Staff } & { admin: Admin };
        if (!user) {
            throw new NotFoundException('User not found');
        }
        if (user.admin && user.admin.isActive) {
            return true;
        }
        const userRole = user.type === UserType.STAFF && user.auth && user.staff.role;
        if (!userRole) {
            throw new ForbiddenException('You do not have access to this resource');
        }
        const hasRole = requiredRoles.some((role) => user.staff.role === role);
        if (!hasRole) {
            throw new ForbiddenException('You do not have access to this resource');
        }
        return hasRole;
    }
}