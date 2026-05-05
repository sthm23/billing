import { PartialType } from '@nestjs/mapped-types';
import { CreateAttributeValueDto } from './create-category-attribute.dto';

export class UpdateCategoryAttributeDto extends PartialType(CreateAttributeValueDto) { }
