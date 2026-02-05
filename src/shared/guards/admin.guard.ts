import { UserRole } from "@generated/enums";
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(ctx: ExecutionContext) {
        const user = ctx.switchToHttp().getRequest().user;
        const isAdmin = user && user?.auth && user.auth.isActive && user.role === UserRole.ADMIN;
        if (!isAdmin) {
            throw new ForbiddenException('Admin access required');
        }
        return isAdmin;
    }
}
