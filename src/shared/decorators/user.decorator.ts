import { UserAuth } from '@auth/models/auth.model';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUser as CurrentUserType } from '@auth/models/auth.model';
export const CurrentUser = createParamDecorator(
    (data: keyof UserAuth, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user as CurrentUserType;
        return data ? user[data] : user;
    },
);