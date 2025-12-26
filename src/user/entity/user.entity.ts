
import { Prisma, StaffRole } from '@generated/client';


export class UserEntity {
    login: string = '';
    password: string = '';
    name: string = '';
    company: string = '';
    role: StaffRole = StaffRole.SELLER;
    phoneNumber: string = '';

    constructor(partial: Partial<Prisma.UserCreateInput>) {
        Object.assign(this, partial);
    }
}