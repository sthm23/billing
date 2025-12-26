import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { UserModule } from '@user/user.module';
import { LocalStrategy } from './strategy/local.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategy/jwt-access.strategy';
import { AdminModule } from '@admin/admin.module';
import { AdminGuard } from './guard/admin.guard';
import { TokenService } from './token.service';

@Module({
  imports: [
    UserModule,
    AdminModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        return {
          secret: configService.get<string>('JWT_ACCESS'),
          signOptions: {
            expiresIn: configService.get<any>('JWT_ACCESS_EXPIRE'),
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
    AuthJWTGuard,
    AdminGuard,
    TokenService
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule { }
