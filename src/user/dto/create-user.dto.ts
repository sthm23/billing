import { UserType } from "@generated/enums"
import { UserCreateInput } from "@generated/models";
import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from "class-validator"

export class CreateUserDto {
    @IsNotEmpty()
    fullName!: string;

    @IsNotEmpty()
    phone!: string;

    @IsEnum(UserType)
    type: UserType = UserType.CUSTOMER;

    @IsOptional()
    @IsUUID('4')
    orderId?: string;

    constructor(obj: Partial<UserCreateInput>) {
        Object.assign(this, obj);
    }
}