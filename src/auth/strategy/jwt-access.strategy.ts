import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessTokenPayload } from '../models/auth.model';
import { PrismaService } from '@prisma/prisma.service';
import { isAccountActive } from '../account-status';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    const secretOrKey = config.get('JWT_ACCESS_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey,
    });
  }

  async validate(payload: AccessTokenPayload) {
    if (!payload.sid) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        // The token's session: logout / refresh rotation revokes it, and then
        // the access token stops working at once (not only after it expires)
        refreshSessions: {
          where: {
            id: payload.sid,
            isRevoked: false,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
          take: 1,
        },
        staff: {
          select: {
            id: true,
            isActive: true,
            role: true,
            storeId: true,
            warehouse: true,
            // Subscription check (SubscriptionGuard) — reloaded on every request
            store: {
              select: {
                name: true,
                status: true,
                suspendedAt: true,
                suspendReason: true,
              },
            },
          },
        },
        auth: {
          select: {
            id: true,
            login: true,
            passwordHash: true,
            isActive: true,
          },
        },
      },
    });
    // No user, a deactivated account or a revoked session → 401
    // (passport rejects a null user)
    if (!user || !isAccountActive(user)) return null;
    const { refreshSessions, ...rest } = user;
    if (refreshSessions.length === 0) return null;
    return { ...rest, sessionId: payload.sid };
  }
}
