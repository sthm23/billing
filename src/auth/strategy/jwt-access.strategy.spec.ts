import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '@prisma/prisma.service';
import { JwtStrategy } from './jwt-access.strategy';

describe('JwtStrategy', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const config = { get: jest.fn().mockReturnValue('secret') };
  let strategy: JwtStrategy;

  const activeUser = (sessions: { id: string }[]) => ({
    id: 'user',
    auth: { isActive: true },
    staff: { isActive: true },
    refreshSessions: sessions,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
  });

  it('accepts a token of a live session and strips the session list', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUser([{ id: 'sid' }]));
    const user = await strategy.validate({
      sub: 'user',
      sid: 'sid',
      type: 'access',
    });
    expect(user).toMatchObject({ id: 'user', sessionId: 'sid' });
    expect(user).not.toHaveProperty('refreshSessions');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          refreshSessions: expect.objectContaining({
            where: expect.objectContaining({ id: 'sid', isRevoked: false }),
          }),
        }),
      }),
    );
  });

  it('rejects a token whose session is revoked or expired', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUser([]));
    await expect(
      strategy.validate({ sub: 'user', sid: 'sid', type: 'access' }),
    ).resolves.toBeNull();
  });

  it('rejects a token without a session id', async () => {
    await expect(
      strategy.validate({ sub: 'user', type: 'access' } as never),
    ).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
