import { StaffRole, UserType } from '@generated/enums';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HashingHelper } from '@utils/helper/hash.helper';
import { PrismaService } from 'src/db/prisma.service';


@Injectable()
export class SuperUserService implements OnModuleInit {
    constructor(
        private prismaService: PrismaService,
        private configService: ConfigService,
    ) { }

    async onModuleInit() {
        const existingSuperUser = await this.getAdmin()[0];

        if (!existingSuperUser) {
            console.log('Creating super admin...');
            const password = this.configService.get<string>('SUPER_ADMIN_PASSWORD') || 'SuperAdmin@123';
            const hashedPassword = await HashingHelper.hash(password, Number(this.configService.get<number>('SALT')) || 10);
            const superUser = {
                login: 'admin',
                password: hashedPassword,
                name: 'Sanjar Tukhtamishev',
                sellers: 'sthm23',
                phone: '+998777377177'
            };
            const user = await this.prismaService.user.create({
                data: {
                    fullName: superUser.name,
                    phone: superUser.phone,
                    type: UserType.STAFF,
                    auth: {
                        create: {
                            login: superUser.login,
                            passwordHash: superUser.password,
                        }

                    }
                }
            });
            await this.prismaService.admin.create({
                data: {
                    userId: user.id,
                    isActive: true,
                },
                include: { user: true },
            });
            console.log('Super admin is created.');

        } else {
            console.log('Super admin already exists.');
        }
    }

    async getAdmin() {
        return this.prismaService.admin.findFirst({
            include: { user: true },
        });
    }
}
