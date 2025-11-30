
import { Prisma } from '@generated/client';
import { ROLE } from '@utils/model/role.model';


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