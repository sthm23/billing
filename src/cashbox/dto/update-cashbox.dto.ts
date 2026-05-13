import { PartialType } from '@nestjs/mapped-types';
import { CreateCashBoxDto } from './create-cashbox.dto';

export class UpdateCashboxDto extends PartialType(CreateCashBoxDto) { }
