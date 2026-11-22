import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { PrismaService } from '@prisma/prisma.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

describe('AuthService', () => {
  let service: AuthService;
  const prisma = {
    refreshSession: { update: jest.fn(), updateMany: jest.fn() },
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.refreshSession.update.mockResolvedValue({
      id: 'sid',
      userId: 'user',
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: {} },
        { provide: getLoggerToken(AuthService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('logout', () => {
    it('revokes only the current session by default', async () => {
      await service.logout({ sessionId: 'sid', allDevices: false });
      expect(prisma.refreshSession.update).toHaveBeenCalledWith({
        where: { id: 'sid' },
        data: { isRevoked: true },
      });
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    });

    it('revokes every session of the user with allDevices', async () => {
      await service.logout({ sessionId: 'sid', allDevices: true });
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user', isRevoked: false },
        data: { isRevoked: true },
      });
    });
  });
});
