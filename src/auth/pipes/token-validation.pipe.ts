
import { LogoutDto } from '@auth/dto/logout-dto';
import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class TokenValidationPipe implements PipeTransform {
    constructor(private jwtService: JwtService) { }

    async transform(value: LogoutDto) {
        try {
            const token = await this.jwtService.verifyAsync(value.sessionId, {
                secret: process.env.JWT_ACCESS_SECRET,
                ignoreExpiration: true
            });
            return { ...value, sessionId: token.sid };
        } catch (error: any) {
            throw new UnauthorizedException('Invalid token');
        }
    }
}