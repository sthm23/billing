import { UserRole } from "@generated/enums";
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(ctx: ExecutionContext) {
        const user = ctx.switchToHttp().getRequest().user;
        return user?.auth?.isActive && user?.role === UserRole.ADMIN;
    }
}
