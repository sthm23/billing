import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, User, UserRole, UserType } from '@generated/client';
import { CreateUserDto } from './dto/create-user.dto';
import { CurrentUser } from '@auth/models/auth.model';
import { UpdateCustomerDto } from './dto/update-user.dto';

@Injectable()
export class UserService {
  constructor(
    private prismaService: PrismaService,
    @InjectPinoLogger(UserService.name) private readonly logger: PinoLogger,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    try {
      const user = await this.prismaService.user.findFirst({
        where: {
          phone: createUserDto.phone,
        },
      });
      if (user) {
        this.logger.warn(
          { phone: createUserDto.phone },
          'User creation rejected: phone already exists',
        );
        throw new ConflictException('Phone already existing');
      }
      const userEntity = new CreateUserDto(createUserDto);

      const newUser = await this.prismaService.user.create({
        data: userEntity,
      });
      this.logger.info({ userId: newUser.id }, 'User created');
      return newUser;
    } catch (error: any) {
      this.logger.error(
        { phone: createUserDto.phone, err: error.message },
        'Failed to create user',
      );
      throw new BadRequestException(error.response || error.message);
    }
  }

  /** A customer can be attached only to an order of the user's own store (admin: any). */
  private async assertOrderInUserStore(orderId: string, user: CurrentUser) {
    if (user.role === UserRole.ADMIN) return;
    const order = await this.prismaService.order.findUnique({
      where: { id: orderId },
      select: { storeId: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!user.staff || order.storeId !== user.staff.storeId) {
      throw new ForbiddenException('No access to this order');
    }
  }

  async createCustomers(
    createUserDto: CreateUserDto,
    user: CurrentUser,
  ): Promise<User> {
    if (createUserDto.orderId) {
      await this.assertOrderInUserStore(createUserDto.orderId, user);
    }
    try {
      const existing = await this.prismaService.user.findFirst({
        where: {
          phone: createUserDto.phone,
        },
        include: {
          customer: true,
        },
      });
      if (existing) {
        this.logger.warn(
          { phone: createUserDto.phone },
          'Customer creation rejected: phone already exists',
        );
        // The customer may belong to another store: they are found by the full number
        throw new ConflictException(
          'A customer with this phone already exists — search by the full phone number',
        );
      }

      return await this.prismaService.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            fullName: createUserDto.fullName,
            phone: createUserDto.phone,
            type: UserType.CUSTOMER,
          },
        });
        const customer = await tx.customer.create({
          data: {
            userId: newUser.id,
            // The store that created the customer sees them in its search
            ...(user.staff
              ? { stores: { connect: { id: user.staff.storeId } } }
              : {}),
          },
        });
        if (createUserDto.orderId) {
          await tx.order.update({
            where: { id: createUserDto.orderId },
            data: { customerId: customer.id },
          });
        }
        this.logger.info({ userId: newUser.id }, 'Customer created');
        return Promise.resolve({ ...newUser, customer });
      });
    } catch (error: any) {
      this.logger.error(
        { phone: createUserDto.phone, err: error.message },
        'Failed to create customer',
      );
      if (error instanceof ConflictException) throw error;
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findAllOwners(pageSize = 10, currentPage = 1, user: CurrentUser) {
    const skip = (currentPage - 1) * pageSize;
    const param = {
      role: UserRole.OWNER,
      staff:
        user.role === UserRole.ADMIN
          ? undefined
          : { storeId: user.staff!.storeId },
    } as Prisma.UserWhereInput;

    try {
      const result = await this.prismaService.user.findMany({
        skip: skip,
        take: +pageSize,
        where: param,
        include: {
          staff: true,
        },
      });
      const count = await this.prismaService.user.count({ where: param });
      return {
        currentPage,
        pageSize,
        total: count,
        data: result,
      };
    } catch (error: any) {
      this.logger.error({ err: error.message }, 'User query failed');
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findAll(pageSize = 10, currentPage = 1, user: CurrentUser) {
    const skip = (currentPage - 1) * pageSize;
    const param = {
      type: { not: UserType.CUSTOMER },
      staff:
        user.role === UserRole.ADMIN
          ? undefined
          : { storeId: user.staff!.storeId },
    } as Prisma.UserWhereInput;

    try {
      const result = await this.prismaService.user.findMany({
        skip: skip,
        take: +pageSize,
        where: param,
        include: {
          staff: true,
        },
      });
      const count = await this.prismaService.user.count({ where: param });
      return {
        currentPage,
        pageSize,
        total: count,
        data: result,
      };
    } catch (error: any) {
      this.logger.error({ err: error.message }, 'User query failed');
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findOneById(id: string): Promise<Omit<User, 'password'> | null> {
    try {
      return await this.prismaService.user.findUnique({
        where: { id },
        include: {
          auth: true,
          staff: {
            include: {
              store: true,
              warehouse: true,
            },
          },
        },
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findOneInfo(id: string): Promise<any | null> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id },
        include: {
          auth: true,
          staff: {
            include: {
              payments: true,
              orders: true,
            },
          },
        },
      });
      return user;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
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
      throw new BadRequestException(error.response || error.message);
    }
  }

  /**
   * Customer search for an order. The store's own customers (linked to it,
   * bought or owe there) — by part of the name or phone; customers of other
   * stores — only by the full phone number, so a store can't browse another
   * store's customer list. An admin sees all.
   */
  async getCustomers(
    pageSize = 10,
    currentPage = 1,
    search: string | undefined,
    user: CurrentUser,
  ) {
    const skip = (currentPage - 1) * pageSize;
    const text = search?.trim() ?? '';
    const where: Prisma.UserWhereInput = { type: UserType.CUSTOMER };
    const and: Prisma.UserWhereInput[] = [];

    if (text) {
      and.push({
        OR: [
          { phone: { contains: text, mode: 'insensitive' } },
          { fullName: { contains: text, mode: 'insensitive' } },
        ],
      });
    }
    if (user.role !== UserRole.ADMIN) {
      if (!user.staff) throw new ForbiddenException('Staff only');
      const storeId = user.staff.storeId;
      const ownCustomer: Prisma.UserWhereInput = {
        customer: {
          OR: [
            { stores: { some: { id: storeId } } },
            { orders: { some: { storeId } } },
            { customerDebts: { some: { storeId } } },
          ],
        },
      };
      const phones = fullPhoneVariants(text);
      // Own customers by the text; anyone else only by the full number
      and.push(
        phones ? { OR: [ownCustomer, { phone: { in: phones } }] } : ownCustomer,
      );
    }
    if (and.length) where.AND = and;

    try {
      const [count, data] = await Promise.all([
        this.prismaService.user.count({ where }),
        this.prismaService.user.findMany({
          skip,
          take: +pageSize,
          where,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fullName: true,
            phone: true,
            type: true,
            createdAt: true,
            customer: true,
          },
        }),
      ]);
      return {
        currentPage,
        pageSize,
        total: count,
        data,
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async setCustomerToOrder(dto: UpdateCustomerDto, user: CurrentUser) {
    await this.assertOrderInUserStore(dto.orderId, user);
    try {
      const customer = await this.prismaService.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException(
          `Customer with ID ${dto.customerId} not found`,
        );
      }
      await this.prismaService.order.update({
        where: { id: dto.orderId! },
        data: { customerId: dto.customerId },
      });
      return { message: 'Customer assigned to order successfully' };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async deactivate(id: string) {
    try {
      const result = await this.prismaService.user.findUnique({
        where: { id },
        include: {
          auth: true,
          staff: true,
        },
      });
      if (!result) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      let data = {};
      if (result.staff && result.staff.isActive) {
        data = { ...data, staff: { update: { isActive: false } } };
      }
      if (result.auth && result.auth.isActive) {
        data = { ...data, auth: { update: { isActive: false } } };
      }

      await this.prismaService.user.update({
        where: { id },
        include: { auth: true, staff: true },
        data: data,
      });
      this.logger.info({ userId: id }, 'User deactivated');
      return {
        login: result.auth!.login,
        message: 'User deactivated successfully',
      };
    } catch (error: any) {
      this.logger.error(
        { userId: id, err: error.message },
        'Failed to deactivate user',
      );
      throw new BadRequestException(error.response || error.message);
    }
  }
}

/**
 * Ways a full Uzbek number may be stored («+998901234567», «998901234567»,
 * «901234567»), or null when the text is not a full number (9+ digits).
 */
export function fullPhoneVariants(text: string): string[] | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length < 9) return null;
  const local =
    digits.length === 12 && digits.startsWith('998') ? digits.slice(3) : digits;
  if (local.length !== 9) return [digits, `+${digits}`];
  return [local, `998${local}`, `+998${local}`];
}
