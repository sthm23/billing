import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, Staff, StaffRole, User, UserRole, UserType } from '@generated/client';
import { CreateUserDto } from './dto/create-user.dto';
import { HashingHelper } from '@shared/helper/hash.helper';
import { CurrentUser } from '@auth/models/auth.model';

@Injectable()
export class UserService {

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) { }

  async create(createUserDto: CreateUserDto): Promise<User> {
    try {
      const user = await this.prismaService.user.findFirst({
        where: {
          phone: createUserDto.phone
        }
      })
      if (user) throw new ConflictException('Phone already existing');
      const userEntity = new CreateUserDto(createUserDto);

      return this.prismaService.user.create({
        data: userEntity
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createCustomers(createUserDto: CreateUserDto): Promise<User> {
    try {
      const user = await this.prismaService.user.findFirst({
        where: {
          phone: createUserDto.phone
        },
        include: {
          customer: true
        }
      })
      if (user) throw new ConflictException('Phone already existing');
      const userEntity = new CreateUserDto(createUserDto);
      return await this.prismaService.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: userEntity,
          include: {
            customer: true,
          }
        })
        const customer = await tx.customer.create({
          data: {
            userId: newUser.id
          }
        })
        return Promise.resolve({ ...newUser, customer });
      })
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAllOwners(pageSize = 10, currentPage = 1, user: CurrentUser) {
    const skip = (currentPage - 1) * pageSize;
    const param = {
      role: UserRole.OWNER,
      staff: user.role === UserRole.ADMIN ? undefined : { storeId: user.staff!.storeId }
    } as Prisma.UserWhereInput;

    try {
      const result = await this.prismaService.user.findMany({
        skip: skip,
        take: +pageSize,
        where: param,
        include: {
          staff: true,
        }
      });
      const count = await this.prismaService.user.count({ where: param });
      return {
        currentPage,
        pageSize,
        total: count,
        data: result
      };
    } catch (error: any) {
      console.log(error);
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAll(pageSize = 10, currentPage = 1, user: CurrentUser) {
    const skip = (currentPage - 1) * pageSize;
    const param = {
      staff: user.role === UserRole.ADMIN ? undefined : { storeId: user.staff!.storeId }
    } as Prisma.UserWhereInput;

    try {
      const result = await this.prismaService.user.findMany({
        skip: skip,
        take: +pageSize,
        where: param,
        include: {
          staff: true,
        }
      });
      const count = await this.prismaService.user.count({ where: param });
      return {
        currentPage,
        pageSize,
        total: count,
        data: result
      };
    } catch (error: any) {
      console.log(error);
      throw new BadRequestException(error.response || error.message)
    }
  }


  async findOneById(id: string): Promise<Omit<User, 'password'> | null> {
    try {
      return await this.prismaService.user.findUnique({
        where: { id }, include: {
          auth: true,
          staff: {
            include: {
              store: true,
              warehouse: true,
            }
          },

        }
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
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
          staff: true,
        },
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }

  }

  async getCustomers() {
    try {
      const count = await this.prismaService.user.count({
        where: {
          type: UserType.CUSTOMER
        }
      })
      const data = await this.prismaService.customer.findMany({
        include: {
          user: true,
          stores: true,
        }
      })
      return { count, data }
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async update(id: string, dto: UpdateUserDto) {
    try {
      return this.prismaService.user.update({
        where: { id },
        data: dto,
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async remove(id: string) {
    try {
      const result = await this.prismaService.user.findUnique({
        where: { id }, include: {
          auth: true,
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

      await this.prismaService.user.update({ where: { id }, include: { auth: true, staff: true }, data: data });
      return { login: result.auth!.login, message: 'User deactivated successfully' };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }
}
