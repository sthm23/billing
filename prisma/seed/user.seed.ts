import { PrismaClient, UserRole, UserType } from "../../generated/prisma/client";
import * as bcrypt from 'bcrypt';

export async function seedUsers(prisma: PrismaClient) {
    await prisma.user.deleteMany({
        where: { role: UserRole.ADMIN }
    });
    const password = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
    const email = process.env.INIT_ADMIN_EMAIL || 'admin';
    const SALT = process.env.SALT || '10';
    const hashedPassword = await bcrypt.hash(password, Number(SALT) || 10);
    const user = {
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
    }

    await prisma.user.create({
        data: user
    });
}