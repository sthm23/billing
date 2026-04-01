import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@prisma/prisma.service";
import { addDays } from "@shared/helper/date.helper";
import { HashingHelper } from "@shared/helper/hash.helper";
import { AccessTokenPayload, LoginResponse, RefreshTokenPayload } from "./models/auth.model";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";


@Injectable()
export class TokenService {
    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
        private jwtService: JwtService
    ) { }


    async refreshTokens(refreshToken: string): Promise<LoginResponse> {

        try {
            const payload: RefreshTokenPayload = await this.jwtService.verifyAsync(refreshToken, {
                secret: this.refreshTokenSecret
            });

            const tokenFromDb =
                await this.findValidToken(payload.sub, refreshToken);

            if (!tokenFromDb) {
                throw new UnauthorizedException('Invalid refresh token');
            }

            await this.prisma.refreshSession.update({ where: { id: tokenFromDb.id }, data: { isRevoked: true } });

            const newRefreshToken = await this.generateToken({
                sub: payload.sub,
                type: 'refresh'
            }, {
                secret: this.refreshTokenSecret,
                expiresIn: this.refreshTokenExpire,
            });

            const savedRefreshToken = await this.saveRefreshToken(payload.sub, newRefreshToken);
            const accessToken = await this.generateToken({
                sub: payload.sub,
                sid: savedRefreshToken.id,
                type: 'access'
            }, {
                secret: this.accessTokenSecret,
                expiresIn: this.accessTokenExpire,
            });
            return { accessToken, refreshToken: newRefreshToken };
        } catch (error: any) {
            throw new UnauthorizedException(error.response || error.message)
        }
    }

    private async saveRefreshToken(userId: string, refreshToken: string) {
        const hash = await HashingHelper.hash(refreshToken, Number(process.env.SALT) || 10);

        const token = await this.prisma.refreshSession.create({
            data: {
                userId,
                refreshHash: hash,
                expiresAt: addDays(new Date(), 7),
            }
        });

        return token
    }

    private async findValidToken(userId: string, refreshToken: string) {
        const tokens = await this.prisma.refreshSession.findMany({
            where: { userId, isRevoked: false },
        });

        for (const token of tokens) {
            const isMatch = await HashingHelper.isMatch(
                refreshToken,
                token.refreshHash,
            );
            if (isMatch) return token;
        }

        return null;
    }

    generateToken(payload: AccessTokenPayload | RefreshTokenPayload, options: JwtSignOptions) {
        return this.jwtService.signAsync(payload, options);
    }

    get refreshTokenSecret() {
        return this.configService.get<string>('JWT_REFRESH_SECRET');
    }

    get refreshTokenExpire() {
        return this.configService.get<number>('JWT_REFRESH_EXPIRE');
    }

    get accessTokenSecret() {
        return this.configService.get<string>('JWT_ACCESS_SECRET');
    }

    get accessTokenExpire() {
        return this.configService.get<number>('JWT_ACCESS_EXPIRE');
    }
}