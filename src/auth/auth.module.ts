import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { UserModule } from '@user/user.module';
import { LocalStrategy } from './strategy/local.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RefreshTokenGuard } from './guard/refresh-token.guard';
import { JwtStrategy } from './strategy/jwt-access.strategy';
import { RefreshTokenStrategy } from './strategy/jwt-refresh.strategy';
import { AdminModule } from '@admin/admin.module';
import { AdminGuard } from './guard/admin.guard';

@Module({
  imports: [
    UserModule,
    AdminModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        return {
          secret: configService.get<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: configService.get<any>('JWT_EXPIRES_IN'),
          },
        };
      },
      inject: [ConfigService]
    }),

  ],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    RefreshTokenStrategy,
    AuthJWTGuard,
    AdminGuard,
    RefreshTokenGuard,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule { }
