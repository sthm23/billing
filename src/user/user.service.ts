import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import { HashingHelper } from '@utils/helper/hash.helper';

import { type JWTPayload } from '@auth/models/auth.model';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, StaffRole, User } from '@generated/client';
import { UserEntity } from './entity/user.entity';

@Injectable()
export class UserService {

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) { }

  // async create(createUserDto: Prisma.UserCreateInput): Promise<User> {
  //   try {
  //     const user = await this.prismaService.user.findUnique({
  //       where: { login: createUserDto.login }
  //     })
  //     if (user) throw new ForbiddenException('login already existing');
  //     const userEntity = new UserEntity(createUserDto);

  //     userEntity.password = await HashingHelper.hash(
  //       userEntity.password,
  //       +this.configService.get('SALT')
  //     );
  //     const newUser = this.prismaService.user.create({
  //       data: userEntity
  //     });
  //     return newUser
  //   } catch (error: any) {
  //     throw new BadRequestException(error.message);
  //   }
  // }

  // findAll(payload: JWTPayload): Promise<Omit<User, 'password'>[]> {
  //   try {
  //     if (payload.role === ROLE.ADMIN) {
  //       return this.prismaService.user.findMany({
  //         omit: {
  //           password: true,
  //         },
  //       });
  //     }
  //     return this.prismaService.user.findMany({ where: { company: payload.company }, omit: { password: true } });
  //   } catch (error: any) {
  //     console.log(error);

  //     throw new BadRequestException(error.message);
  //   }
  // }

  // async findOneByLogin(login: string): Promise<User | null> {
  //   try {
  //     return this.prismaService.user.findUnique({
  //       where: { login },
  //     });
  //   } catch (error: any) {
  //     throw new BadRequestException(error?.message);
  //   }

  // }


  // async findOneById(id: string): Promise<Omit<User, 'password'> | null> {
  //   try {
  //     return await this.prismaService.user.findUnique({
  //       where: { id: id },
  //       omit: {
  //         password: true,
  //       },
  //     });
  //   } catch (error: any) {
  //     throw new BadRequestException(error.message);
  //   }

  // }

  // async update(id: string, { password, ...updateUserDto }: UpdateUserDto) {
  //   try {
  //     const updatedUser = await this.prismaService.user.findUnique({
  //       where: { id: id }
  //     });
  //     if (!updatedUser) {
  //       throw new NotFoundException(`User with ID ${id} not found`);
  //     }
  //     return this.prismaService.user.update({
  //       where: { id: id },
  //       omit: { password: true },
  //       data: updateUserDto
  //     });
  //   } catch (error: any) {
  //     throw new BadRequestException(error.message);
  //   }

  // }

  // async remove(id: string) {
  //   try {
  //     const result = await this.prismaService.user.findUnique({ where: { id } });
  //     if (!result) {
  //       throw new NotFoundException(`User with ID ${id} not found`);
  //     }
  //     await this.prismaService.user.update({ where: { id }, data: { isActive: false } });
  //     return { login: result.login, message: 'User deactivated successfully' };
  //   } catch (error: any) {
  //     throw new BadRequestException(error.message);
  //   }
  // }
}
