import { IsEnum, IsString, IsNotEmpty, IsOptional } from "class-validator"
import { ROLE } from "@utils/model/role.model"

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
    company: string

    @IsNotEmpty()
    @IsString()
    phoneNumber!: string

    @IsNotEmpty()
    @IsEnum(ROLE)
    role: ROLE

    constructor(obj: Partial<CreateUserDto>) {
        this.role = ROLE.USER
        this.company = ''
        Object.assign(this, obj);
    }
}
