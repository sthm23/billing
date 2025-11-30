import { ROLE } from '@generated/enums';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HashingHelper } from '@utils/helper/hash.helper';
import { PrismaService } from 'src/db/prisma.service';


@Injectable()
export class SuperUserService implements OnModuleInit {
    constructor(private prismaService: PrismaService, private configService: ConfigService) { }

    async onModuleInit() {
        const existingSuperUser = await this.prismaService.user.findUnique({
            where: { login: 'admin' }
        });

        if (!existingSuperUser) {
            console.log('Creating super admin...');
            const password = this.configService.get<string>('SUPER_ADMIN_PASSWORD') || 'SuperAdmin@123';
            const hashedPassword = await HashingHelper.hash(password, Number(this.configService.get<number>('SALT')) || 10);
            const superUser = {
                login: 'admin',
                password: hashedPassword,
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
