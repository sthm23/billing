import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { SignInDto } from './dto/create-login.dto';
import { LocalAuthGuard } from '@auth/guard/local_passport.guard';
import type { UserAuth } from './models/auth.model';
import type { Response, Request } from 'express';
import { AuthJWTGuard } from './guard/auth.guard';

@Controller()
export class AuthController {
  constructor(private authService: AuthService) { }

  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @CurrentUser() user: UserAuth,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {

    const { accessToken, refreshToken } = await this.authService.login(user.id, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
    });

    return { accessToken }
  }

  @Post('signup')
  signup(@Body(new ValidationPipe()) dto: SignInDto) {
    return this.authService.signUp(dto);
  }


  @Get('refresh')
  async refreshTokens(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken as string | undefined;

    if (!refreshToken) {
      throw new UnauthorizedException();
    }
    const { accessToken, refreshToken: newRefresh } =
      await this.authService.refreshToken(refreshToken);
    // rotation
    res.cookie('refreshToken', newRefresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    return { accessToken };
  }

  @UseGuards(AuthJWTGuard)
  @HttpCode(HttpStatus.OK)
  @Get('logout')
  async logout(
    @Req() req: Request & { user: UserAuth & { sessionId: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logout(req.user.sessionId);
    if (result) {
      res.clearCookie('refreshToken', {
        path: '/api/refresh',
      });
    }
    return { success: true };
  }
}