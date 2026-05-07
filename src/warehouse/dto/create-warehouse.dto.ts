import { Type } from "class-transformer";
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";


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
    @IsUUID('4')
    storeId: string = ''

    @IsNotEmpty()
    @IsString()
    name: string = ''

    @IsNotEmpty()
    @IsUUID('4')
    ownerId: string = ''

    @IsOptional()
    @ValidateNested()
    worker?: CreateWarehouseStaffDto

    constructor(dto: Partial<CreateWarehouseDto>) {
        Object.assign(this, dto);
    }
}

export class AddInventoryDto {
    @IsNotEmpty()
    @IsUUID('4')
    variantId!: string;

    @IsNotEmpty()
    @IsUUID('4')
    warehouseId!: string;

    @IsNumber()
    @Type(() => Number)
    @Min(1)
    quantity!: number;

    @IsNumber()
    @Type(() => Number)
    @Min(1)
    costPrice!: number;

    @IsNumber()
    @Type(() => Number)
    @Min(1)
    price!: number;
}