import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { PrismaService } from '@prisma/prisma.service';

@Injectable()
export class ReportService {
  constructor(private prisma: PrismaService) { }
  create(createReportDto: CreateReportDto) {
    return 'This action adds a new report';
  }

  async findAll(pageSize = 10, currentPage = 1) {
    const skip = (currentPage - 1) * pageSize;
    try {
      //             const result = await this.prisma.report.findMany({
      //   skip: skip,
      //   take: pageSize,
      // });
      // const count = await this.prisma.report.count();
      // return {
      //   currentPage,
      //   pageSize,
      //   total: count,
      //   data: result
      // };
      return { currentPage, pageSize, total: 0, data: [] };
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} report`;
  }

  update(id: string, updateReportDto: UpdateReportDto) {
    return `This action updates a #${id} report`;
  }

  remove(id: string) {
    return `This action removes a #${id} report`;
  }
}
