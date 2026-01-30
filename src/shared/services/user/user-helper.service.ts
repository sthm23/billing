import { AuthAccount, User } from '@generated/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';

@Injectable()
export class UserHelperService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    async checkUserExistenceByLoginOrPhone(login: string, phone: string): Promise<User & { auth: Partial<AuthAccount> | null } | null> {
        const user = await this.prisma.user.findFirst({
            where: {
                OR: [
                    {
                        auth: {
                            login: login
                        }
                    },
                    { phone: phone }
                ]
            },
            include: { auth: true },
        });

        return user;
    }
}
