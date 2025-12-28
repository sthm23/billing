import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, StaffRole, User, UserType } from '@generated/client';
import { CreateOwnerDto, CreateUserDto } from './dto/create-user.dto';
import { HashingHelper } from '@utils/helper/hash.helper';

@Injectable()
export class UserService {

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) { }

  async create(createUserDto: Prisma.UserCreateInput): Promise<User> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { phone: createUserDto.phone }
      })
      if (user) throw new ForbiddenException('login already existing');
      const userEntity = new CreateUserDto(createUserDto);

      return this.prismaService.user.create({
        data: userEntity
      });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  async createOwner(dto: CreateOwnerDto) {
    try {
      const passwordHash = await HashingHelper.hash(dto.password, 10);
      const user = await this.prismaService.user.create({
        data: {
          fullName: dto.fullName,
          phone: dto.phone,
          type: UserType.STAFF,
          auth: {
            create: {
              login: dto.login,
              passwordHash
            }
          }
        }
      })


    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  findAll(): Promise<User[]> {
    try {
      return this.prismaService.user.findMany();
    } catch (error: any) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }


  async findOneById(id: string): Promise<Omit<User, 'password'> | null> {
    try {
      return await this.prismaService.user.findUnique({
        where: { id }, include: {
          auth: true,
          admin: true,
          staff: true,
        }
      });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }

  }

  async findByLogin(email: string) {
    try {
      return this.prismaService.user.findFirst({
        where: {
          auth: {
            login: email,
          },
        },
        include: {
          auth: true,
          admin: true,
          staff: true,
        },
      });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }

  }

  async update(id: string, dto: UpdateUserDto) {
    try {
      return this.prismaService.user.update({
        where: { id },
        data: dto,
      });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  async remove(id: string) {
    try {
      const result = await this.prismaService.user.findUnique({
        where: { id }, include: {
          auth: true,
          admin: true,
          staff: true,
        }
      });
      if (!result) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      let data = {};
      if (result.staff && result.staff.isActive) {
        data = { ...data, staff: { update: { isActive: false } } };
      };
      if (result.auth && result.auth.isActive) {
        data = { ...data, auth: { update: { isActive: false } } };
      }
      if (result.admin && result.admin.isActive) {
        data = { ...data, admin: { update: { isActive: false } } };
      }
      await this.prismaService.user.update({ where: { id }, include: { auth: true, admin: true, staff: true }, data: data });
      return { login: result.auth!.login, message: 'User deactivated successfully' };
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }
}
