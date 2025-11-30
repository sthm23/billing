import { ROLE } from '@generated/enums';
import { Injectable, CanActivate, ExecutionContext, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@utils/model/role.model';



@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {

        const requiredRoles = this.reflector.getAllAndOverride<ROLE[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass()
        ])

        if (!requiredRoles) {
            return true;
        }
        const { user } = context.switchToHttp().getRequest();
        const hasRole = requiredRoles.some((role) => user?.role === role);
        if (!hasRole) {
            throw new ForbiddenException('You do not have access to this resource');
        }
        return hasRole;
    }
}