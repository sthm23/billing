import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HashingHelper } from '@shared/helper/hash.helper';
import { UserRole, UserType } from '@generated/enums';

@Injectable()
export class AdminBootstrap implements OnModuleInit {
    constructor(private prisma: PrismaService) { }

    async onModuleInit() {
        const isAdmin = await this.prisma.user.findFirst({
            where: { role: UserRole.ADMIN },
        });

        if (isAdmin) {
            console.log('Super admin already exists.');
            return;
        }

        const password = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
        const email = process.env.INIT_ADMIN_EMAIL || 'admin';
        const SALT = process.env.SALT || '10';
        if (!password || !email) {
            throw new Error('INIT_ADMIN_EMAIL or PASSWORD not set');
        }
        const hashedPassword = await HashingHelper.hash(password, Number(SALT) || 10);
        await this.prisma.user.create({
            data: {
                fullName: 'System Admin',
                phone: '+998777377177',
                role: UserRole.ADMIN,
                type: UserType.STAFF,
                auth: {
                    create: {
                        login: email,
                        passwordHash: hashedPassword,
                    },
                },
            },
        });

        console.log('✅ Initial admin created');
    }
}
