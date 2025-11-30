import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWTPayload } from '../models/auth.model';

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(
    Strategy,
    'jwt-refresh',
) {
    constructor(config: ConfigService) {
        const secretOrKey = config.get('JWT_REFRESH')
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey,
            passReqToCallback: true,
            ignoreExpiration: false,
        });
    }

    validate(req: Request, payload: JWTPayload) {
        const refreshToken = (req.get('Authorization') as string).replace('Bearer', '').trim();
        return { ...payload, refreshToken };
    }
}