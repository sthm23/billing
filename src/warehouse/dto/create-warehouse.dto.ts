import { IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";


export class CreateWarehouseStaffDto {
    @IsNotEmpty()
    @IsString()
    login: string = ''

    @IsNotEmpty()
    @IsString()
    password: string = ''


    @IsNotEmpty()
    @IsString()
    fullName: string = ''

    @IsNotEmpty()
    @IsString()
    phone: string = ''

    @IsNotEmpty()
    @IsUUID('4')
    storeId: string = ''

    constructor(dto: Partial<CreateWarehouseStaffDto>) {
        Object.assign(this, dto);
    }
}
export class CreateWarehouseDto {
    @IsNotEmpty()
    @IsUUID()
    storeId: string = ''

    @IsNotEmpty()
    @IsString()
    name: string = ''

    @IsOptional()
    @ValidateNested()
    worker?: CreateWarehouseStaffDto

    constructor(dto: Partial<CreateWarehouseDto>) {
        Object.assign(this, dto);
    }
}

