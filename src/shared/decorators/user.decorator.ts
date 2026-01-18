import { UserAuth } from '@auth/models/auth.model';
import { Staff } from '@generated/client';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
    (data: keyof UserAuth, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user as UserAuth & { staff: Staff };
        return data ? user[data] : user;
    },
);