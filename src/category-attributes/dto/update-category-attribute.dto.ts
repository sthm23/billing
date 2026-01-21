import { PartialType } from '@nestjs/mapped-types';
import { CreateCategoryAttributeDto } from './create-category-attribute.dto';

export class UpdateCategoryAttributeDto extends PartialType(CreateCategoryAttributeDto) {}
