import { Injectable } from '@nestjs/common';
import { CreateAdminDto } from './dto/create-admin.dto';

@Injectable()
export class AdminService {

  create(createAdminDto: CreateAdminDto) {
    return 'This action adds a new admin';
  }

  findOne(id: string) {
    return `This action returns a #${id} admin`;
  }


  remove(id: string) {
    return `This action removes a #${id} admin`;
  }
}
