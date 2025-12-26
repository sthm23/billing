import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateAdminDto } from './dto/create-admin.dto';
import { PrismaService } from '@prisma/prisma.service';
import { ExceptionsHandler } from '@nestjs/core/exceptions/exceptions-handler';
import { UserType } from '@generated/enums';
import { HashingHelper } from '@utils/helper/hash.helper';

@Injectable()
export class AdminService {

  constructor(private prisma: PrismaService) { }

  async create(dto: CreateAdminDto) {
    try {
      const authAccount = await this.prisma.authAccount.findUnique({
        where: { login: dto.login },
        include: { user: true }
      })
      if (authAccount) throw new NotFoundException('Admin is exist!');
      const newUser = await this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          phone: dto.phone,
          type: UserType.STAFF,
          auth: {
            create: {
              login: dto.login,
              passwordHash: await HashingHelper.hash(dto.password, 10),
            }
          }
        },

      })
      await this.prisma.admin.create({
        data: {
          userId: newUser.id,
          isActive: true,
        },
        include: { user: true },
      });
      return newUser
    } catch (error) {
      throw new NotFoundException('Error with creating admin.')
    }
  }

  async findAll() {
    return this.prisma.admin.findMany({
      include: { user: true },
    });
  }

  async isAdmin(userId: string): Promise<boolean> {
    const admin = await this.prisma.admin.findUnique({
      where: { userId },
    });

    return !!admin?.isActive;
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
        include: { admin: true, auth: true },
        data: { admin: { update: { isActive: false } }, auth: { update: { isActive: false } } }
      })
      return { message: `Admin ${user.auth?.login} successfully deactivated!` }
    } catch (error) {
      throw new NotFoundException('Error with removing admin.')
    }
  }
}
