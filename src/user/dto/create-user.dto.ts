import { StaffRole } from "@generated/enums"
import { IsEnum, IsString, IsNotEmpty, IsOptional } from "class-validator"

export class CreateUserDto {
    @IsNotEmpty()
    @IsString()
    login!: string

    @IsNotEmpty()
    @IsString()
    password!: string

    @IsNotEmpty()
    @IsString()
    name!: string

    @IsOptional()
    @IsString()
    company!: string

    @IsNotEmpty()
    @IsString()
    phoneNumber!: string

    // @IsNotEmpty()
    // @IsEnum(StaffRole)
    // role: StaffRole

    constructor(obj: Partial<CreateUserDto>) {
        // this.role = StaffRole.
        // this.company = ''
        Object.assign(this, obj);
    }
}
