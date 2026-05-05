import { CurrentUser } from '@auth/models/auth.model';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { Injectable, CanActivate, ExecutionContext, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@shared/model/role.model';



@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {

        const requiredRoles = this.reflector.getAllAndOverride<(UserRole | StaffRole)[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass()
        ])

        if (!requiredRoles) {
            return true;
        }
        const user = context.switchToHttp().getRequest().user as CurrentUser;
        if (!user) {
            throw new NotFoundException('User not found');
        }
        if (user.role === UserRole.ADMIN) {
            return true;
        }
        if (user.role === UserRole.OWNER && requiredRoles.includes(UserRole.OWNER)) {
            return true;
        }

        const userRole = user.type === UserType.STAFF && user.auth && user?.staff?.role;
        if (!userRole) {
            throw new ForbiddenException('You do not have access to this resource');
        }
        const hasRole = requiredRoles.some((role) => user.role === role);
        if (!hasRole) {
            throw new ForbiddenException('You do not have access to this resource');
        }
        return hasRole;
    }
}