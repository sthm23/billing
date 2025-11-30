import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import { HashingHelper } from '@utils/helper/hash.helper';

import { type JWTPayload } from '@auth/models/auth.model';
import { ROLE } from '@utils/model/role.model';
import { PrismaService } from 'src/db/prisma.service';
import { Prisma, User } from '@generated/client';
import { UserEntity } from './entity/user.entity';

@Injectable()
export class UserService {

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) { }

  async create(createUserDto: Prisma.UserCreateInput): Promise<User> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { login: createUserDto.login }
      })
      if (user) throw new ForbiddenException('login already existing');
      const userEntity = new UserEntity(createUserDto);

      userEntity.password = await HashingHelper.hash(
        userEntity.password,
        +this.configService.get('SALT')
      );
      const newUser = this.prismaService.user.create({
        data: userEntity
      });
      return newUser
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  findAll(payload: JWTPayload) {
    try {
      if (payload.role === ROLE.ADMIN) {
        return this.prismaService.user.findMany();
      }
      return this.prismaService.user.findMany({ where: { company: payload.company } });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  async validateUser(login: string, pass: string): Promise<User | null> {
    try {
      const user = await this.findOneByLogin(login);
      if (!user) throw new NotFoundException('User not found');
      const isMatch = await HashingHelper.isMatch(pass, user.password);
      if (user && isMatch) {
        return user;
      }
      return null;
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }

  }

  async findOneByLogin(login: string): Promise<User> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { login }
      });
      if (!user) throw new NotFoundException('User not found')
      return user;
    } catch (error: any) {
      throw new BadRequestException(error?.message);
    }

  }


  async findOneById(id: number): Promise<User> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id }
      });
      if (!user) throw new NotFoundException('User not found');
      return user
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }

  }

  async update(id: number, { password, ...updateUserDto }: UpdateUserDto) {
    try {
      const updatedUser = await this.prismaService.user.findUnique({
        where: { id: id }
      });
      if (!updatedUser) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      return this.prismaService.user.update({
        where: { id: id },
        data: updateUserDto
      });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }

  }

  async remove(id: number) {
    try {
      const result = await this.prismaService.user.delete({ where: { id } });
      if (!result) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      return true
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }
}
