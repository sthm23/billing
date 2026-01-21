import { Module } from '@nestjs/common';
import { CategoryAttributesService } from './category-attributes.service';
import { CategoryAttributesController } from './category-attributes.controller';

@Module({
  controllers: [CategoryAttributesController],
  providers: [CategoryAttributesService],
})
export class CategoryAttributesModule {}
