
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWTPayload } from '../models/auth.model';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt-access') {
    constructor(config: ConfigService) {
        const secretOrKey = config.get('JWT_ACCESS')
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey,

        });
    }

    async validate(payload: JWTPayload) {
        return payload;
    }
}
