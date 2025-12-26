import { Injectable } from '@nestjs/common';
import { CreateSellerDto } from './dto/create-seller.dto';
import { UpdateSellerDto } from './dto/update-seller.dto';

@Injectable()
export class SellerService {
  create(createSellerDto: CreateSellerDto) {
    return 'This action adds a new seller';
  }

  findAll() {
    return `This action returns all seller`;
  }

  findOne(id: string) {
    return `This action returns a #${id} seller`;
  }

  update(id: string, updateSellerDto: UpdateSellerDto) {
    return `This action updates a #${id} seller`;
  }

  remove(id: string) {
    return `This action removes a #${id} seller`;
  }
}
