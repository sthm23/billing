import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserType } from '@utils/model/user.model';

export const User = createParamDecorator(
    (data: keyof UserType, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user as UserType;
        return data ? user[data] : user;
    },
);