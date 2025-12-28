import { StaffRole } from "@generated/enums";
import { IsEnum, IsNotEmpty, IsString, IsUUID } from "class-validator";

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
    ownerFullName: string = ''

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
    @IsString()
    name: string = ''

    constructor(dto: Partial<CreateStoreDto>) {
        Object.assign(this, dto)
    }
}
