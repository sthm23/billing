import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CreateAdminDto } from './dto/create-admin.dto';
import { PrismaService } from '@prisma/prisma.service';
import { UserRole, UserType } from '@generated/enums';
import { HashingHelper } from '@shared/helper/hash.helper';

@Injectable()
export class AdminService {

  constructor(
    private prisma: PrismaService,
    @InjectPinoLogger(AdminService.name) private readonly logger: PinoLogger,
  ) { }

  async create(dto: CreateAdminDto) {
    try {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          OR: [
            {
              auth: {
                login: dto.login
              }
            },
            { phone: dto.phone }
          ]
        },
        include: { auth: true },
      });

      if (existingUser) {
        this.logger.warn({ login: dto.login }, 'Admin creation rejected: login or phone already exists');
        throw new ConflictException('Login or Phone is exist!');
      }
      const passwordHash = await HashingHelper.hash(dto.password, 10);
      const newUser = await this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          phone: dto.phone,
          type: UserType.STAFF,
          role: UserRole.ADMIN,
          auth: {
            create: {
              login: dto.login,
              passwordHash
            }
          }
        },

      })
      this.logger.info({ userId: newUser.id, login: dto.login }, 'Admin created');
      return newUser
    } catch (error: any) {
      this.logger.error({ login: dto.login, err: error.message }, 'Failed to create admin');
      throw new BadRequestException('Error with creating admin.')
    }
  }

  async findAll(pageSize = 10, currentPage = 1) {
    const skip = (currentPage - 1) * pageSize;

    try {
      const count = await this.prisma.user.count({ where: { role: UserRole.ADMIN } });
      const result = await this.prisma.user.findMany({
        skip: skip,
        take: +pageSize,
        where: { role: UserRole.ADMIN },
        include: { auth: true }
      });
      return {
        currentPage,
        pageSize,
        total: count,
        data: result
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findOne(id: string) {
    try {
      return this.prisma.user.findUnique({ where: { id } })
    } catch (error) {
      throw new NotFoundException('Error with finding admin.')
    }
  }

  async remove(id: string) {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        include: { auth: true },
        data: { auth: { update: { isActive: false } } }
      })
      this.logger.info({ userId: id, login: user.auth?.login }, 'Admin deactivated');
      return { message: `Admin ${user.auth?.login} successfully deactivated!` }
    } catch (error: any) {
      this.logger.error({ userId: id, err: error.message }, 'Failed to deactivate admin');
      throw new NotFoundException('Error with removing admin.')
    }
  }
}
