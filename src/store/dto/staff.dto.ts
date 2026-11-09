import { StaffDeactivationReason, StaffRole } from '@generated/enums';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** GET /store/staff — filters of the employee list. */
export class StaffListParams {
  /** Part of the full name, phone or login */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  /** Only employees with access to this warehouse (the owner is always listed) */
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;
}

/** PUT /store/staff/:id — only the fields sent are changed. */
export class UpdateStaffDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  login?: string;

  /** Never OWNER — owners are created by an administrator */
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  /** Replaces the employee's warehouses; at least one, all of the store */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  warehouseIds?: string[];
}

/** POST /store/staff/:id/deactivate */
export class DeactivateStaffDto {
  @IsEnum(StaffDeactivationReason)
  reason!: StaffDeactivationReason;
}
