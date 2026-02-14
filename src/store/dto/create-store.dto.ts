import { StaffRole, UserRole, UserType } from "@generated/enums";
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
export class CreateOwnerDto {
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

    constructor(dto: Partial<CreateOwnerDto>) {
        Object.assign(this, dto)
    }
}
export class CreateStoreDto {
    @IsNotEmpty()
    @IsString()
    name: string = ''

    @IsNotEmpty()
    @IsString()
    warehouseName: string = ''

    @IsNotEmpty()
    @IsUUID('4')
    categoryId: string = ''

    @IsNotEmpty()
    @IsUUID('4')
    ownerId: string = ''


}