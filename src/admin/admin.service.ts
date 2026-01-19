import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateAdminDto } from './dto/create-admin.dto';
import { PrismaService } from '@prisma/prisma.service';
import { UserRole, UserType } from '@generated/enums';
import { HashingHelper } from '@shared/helper/hash.helper';

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

      return newUser
    } catch (error) {
      throw new NotFoundException('Error with creating admin.')
    }
  }

  async findAll() {
    return this.prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      include: { auth: true }
    });
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
      return { message: `Admin ${user.auth?.login} successfully deactivated!` }
    } catch (error) {
      throw new NotFoundException('Error with removing admin.')
    }
  }
}
