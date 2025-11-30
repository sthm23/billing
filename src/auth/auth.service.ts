import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { UserService } from '@user/user.service';
import { AuthTokenType, type JWTPayload } from './models/auth.model';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from '@user/dto/create-user.dto';
import { ROLE } from '@utils/model/role.model';
import { User } from '@generated/client';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
    private configService: ConfigService
  ) { }

  async getProfile(id: number) {
    return this.usersService.findOneById(id);
  }

  async signIn(login: string, password: string): Promise<AuthTokenType> {
    const user = await this.usersService.validateUser(login, password);
    if (!user) throw new UnauthorizedException();
    return this.getTokens(user);
  }

  async signUp(createUserDto: CreateUserDto): Promise<{ tokens: AuthTokenType, user: User }> {

    if (createUserDto.role === ROLE.ADMIN) {
      throw new BadRequestException('Admin role can create by Admins');
    }

    try {
      const newUser = await this.usersService.create(createUserDto);
      const tokens = await this.getTokens(newUser);
      return { tokens, user: newUser };
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }



  async refreshTokens({ role, userId }: JWTPayload) {
    const user = await this.usersService.findOneById(userId);
    if (!user) throw new ForbiddenException('Access Denied');
    const secret = this.configService.get('JWT_ACCESS');
    const expiresIn = this.configService.get('JWT_ACCESS_EXPIRE');
    try {
      const token = await this.getToken({
        role: role,
        userId: userId,
        company: user.company
      }, {
        secret,
        expiresIn
      });
      return {
        accessToken: token
      };
    } catch (error) {
      console.log(error);

      throw new ForbiddenException('Access Denied');

    }
  }


  private async getTokens(user: User): Promise<AuthTokenType> {
    const payload = {
      userId: user.id,
      role: user.role,
      company: user.company
    } as JWTPayload;
    try {
      const secret = this.configService.get('JWT_ACCESS');
      const expiresIn = this.configService.get('JWT_ACCESS_EXPIRE');
      const secretRefresh = this.configService.get('JWT_REFRESH');
      const expiresInRefresh = this.configService.get('JWT_REFRESH_EXPIRE');

      const [accessToken, refreshToken] = await Promise.all([
        this.getToken(payload, {
          secret,
          expiresIn,
        }),
        this.getToken(payload, {
          secret: secretRefresh,
          expiresIn: expiresInRefresh,
        }),

      ]);

      return {
        accessToken,
        refreshToken,
      };
    } catch (error: any) {
      throw new ForbiddenException(error?.message);
    }

  }

  private async getToken(payload: JWTPayload, option: JwtSignOptions): Promise<string> {

    return this.jwtService.signAsync(payload, option);
  }

  async validateUser(login: string, pass: string): Promise<User | null> {
    return await this.usersService.validateUser(login, pass)
  }
}