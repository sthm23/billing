import { UserWithAuthAndAdmin } from '@auth/models/auth.model';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
    (data: keyof UserWithAuthAndAdmin, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user as UserWithAuthAndAdmin;
        return data ? user[data] : user;
    },
);