import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { LoginResponse, RefreshTokenPayload, type AccessTokenPayload } from './models/auth.model';
import { UserType } from '@generated/client';
import { HashingHelper } from '@shared/helper/hash.helper';
import { PrismaService } from '@prisma/prisma.service';
import { addDays } from '@shared/helper/date.helper';
import { SignInDto } from './dto/create-login.dto';
import { TokenService } from './token.service';
import { LogoutDto } from './dto/logout-dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService
  ) { }

  async validateUser(email: string, password: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: { auth: { login: email } },
        include: {
          auth: {
            select: {
              id: true,
              login: true,
              isActive: true,
              passwordHash: true,
            }
          },
          staff: {
            select: {
              id: true,
              role: true,
              isActive: true,
              storeId: true,
              warehouseId: true,
            }
          }
        },
      });
      if (!user) return null;
      const userAuth = user?.auth;
      if (!user || !userAuth) return null;
      const isValid = await HashingHelper.isMatch(password, userAuth.passwordHash);
      if (!isValid) return null;

      return user;
    } catch (error) {
      return null;
    }
  }

  async login(userId: string, meta: { ip?: string; ua?: string }): Promise<LoginResponse> {
    const session = await this.prisma.refreshSession.create({
      data: {
        userId: userId,
        refreshHash: '', // временно
        ip: meta.ip,
        userAgent: meta.ua,
        expiresAt: addDays(new Date(), 7),
      },
    });
    const accessTokenPayload: AccessTokenPayload = {
      sub: userId,
      sid: session.id,
      type: 'access'
    }
    const refreshTokenPayload: RefreshTokenPayload = {
      sub: userId,
      type: 'refresh'
    }
    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.generateToken(accessTokenPayload, {
        secret: this.tokenService.accessTokenSecret,
        expiresIn: this.tokenService.accessTokenExpire
      }),
      this.tokenService.generateToken(refreshTokenPayload, {
        secret: this.tokenService.refreshTokenSecret,
        expiresIn: this.tokenService.refreshTokenExpire
      })
    ]);

    const refreshHash = await HashingHelper.hash(refreshToken, 10);

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { refreshHash },
    });

    return { accessToken, refreshToken };
  }

  async refreshToken(token: string) {
    return this.tokenService.refreshTokens(token)
  }

  async signUp(dto: SignInDto): Promise<LoginResponse> {

    try {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          OR: [
            {
              auth: {
                login: dto.login
              }
            },
            { phone: dto.phone }
          ]
        },
        include: { auth: true },
      });
      if (existingUser) throw new ConflictException('Login or Phone is exist!');
      const passwordHash = await HashingHelper.hash(dto.password, 10);
      const newUser = await this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          phone: dto.phone,
          type: UserType.CUSTOMER,
          auth: {
            create: {
              login: dto.login,
              passwordHash,
            }
          }
        }
      });

      return this.login(newUser.id, {});
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async logout(dto: LogoutDto) {
    try {
      const result = await this.prisma.refreshSession.update({
        where: { id: dto.sessionId },
        data: { isRevoked: true },
      });

      return true;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshSession.updateMany({
      where: {
        userId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
      },
    });
  }

  async getMe(userId: string) {
    try {
      return this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          auth: true,
          staff: {
            include: {
              store: true,
              warehouse: true
            }
          }
        }
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}