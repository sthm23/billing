import { StaffRole, UserType } from "@generated/enums";
import { IsBoolean, IsEnum, IsNotEmpty, IsString, IsUUID } from "class-validator";

export class CreateStaffDto {
    @IsNotEmpty()
    @IsString()
    fullName: string = ''

    @IsNotEmpty()
    @IsString()
    phone: string = ''

    @IsNotEmpty()
    @IsString()
    login: string = ''

    @IsNotEmpty()
    @IsString()
    password: string = ''

    @IsNotEmpty()
    @IsEnum(StaffRole)
    role: StaffRole = StaffRole.SELLER

    @IsNotEmpty()
    @IsUUID('4')
    storeId: string = ''

    @IsNotEmpty()
    @IsUUID('4')
    warehouseId: string = ''
}

export class CreateStoreDto {
    @IsNotEmpty()
    @IsString()
    name: string = ''

    @IsNotEmpty()
    @IsUUID('4')
    ownerId: string = ''


}