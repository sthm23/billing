
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessTokenPayload } from '../models/auth.model';
import { PrismaService } from '@prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt-access') {
    constructor(config: ConfigService, private prisma: PrismaService) {
        const secretOrKey = config.get('JWT_ACCESS')
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey
        });
    }

    async validate(payload: AccessTokenPayload) {
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            include: {
                staff: true,
                auth: true,
            },
        });
        return user;
    }
}
