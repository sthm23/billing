import {
  PrismaClient,
  UserRole,
  UserType,
} from '../../generated/prisma/client';
import * as bcrypt from 'bcrypt';

const ADMIN_PHONE = '+998777377177';

/**
 * Ensures the system admin exists. Idempotent and non-destructive — safe to re-run on a live database:
 * an existing admin user and their login/password are never deleted or overwritten.
 */
export async function seedUsers(prisma: PrismaClient) {
  const login = process.env.INIT_ADMIN_EMAIL || 'admin';

  const admin = await prisma.user.upsert({
    where: { phone: ADMIN_PHONE },
    update: {},
    create: {
      fullName: 'System Admin',
      phone: ADMIN_PHONE,
      role: UserRole.ADMIN,
      type: UserType.STAFF,
    },
    include: { auth: true },
  });

  if (admin.auth) return;

  const taken = await prisma.authAccount.findUnique({ where: { login } });
  if (taken) {
    console.warn(
      `⚠️ Admin has no auth account, but login "${login}" is used by another user — skipped`,
    );
    return;
  }

  const password = process.env.SUPER_ADMIN_PASSWORD || 'test';
  const SALT = process.env.SALT || '10';
  const passwordHash = await bcrypt.hash(password, Number(SALT) || 10);
  await prisma.authAccount.create({
    data: { userId: admin.id, login, passwordHash },
  });
}
