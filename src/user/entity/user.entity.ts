
import { Prisma, ROLE } from '@generated/client';


export class UserEntity {
    login: string = '';
    password: string = '';
    name: string = '';
    company: string = '';
    role: ROLE = ROLE.USER;
    phoneNumber: string = '';

    constructor(partial: Partial<Prisma.UserCreateInput>) {
        Object.assign(this, partial);
    }
}