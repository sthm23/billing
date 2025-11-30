import { Injectable, OnModuleInit } from '@nestjs/common';
import { ROLE } from '@utils/model/role.model';
import { PrismaService } from 'src/db/prisma.service';


@Injectable()
export class SuperUserService implements OnModuleInit {
    constructor(private prismaService: PrismaService) { }

    async onModuleInit() {
        const existingSuperUser = await this.prismaService.user.findUnique({
            where: { login: 'admin' }
        });

        if (!existingSuperUser) {
            console.log('Creating super admin...');

            const superUser = {
                login: 'admin',
                password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123',
                name: 'Sanjar Tukhtamishev',
                company: 'sthm23',
                role: ROLE.ADMIN,
                phoneNumber: '+998777377177'
            };
            await this.prismaService.user.create({ data: superUser });
            console.log('Super admin is created.');
        } else {
            console.log('Super admin already exists.');
        }
    }
}
