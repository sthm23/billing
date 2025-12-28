import { UserType } from "@generated/enums"
import { UserCreateInput } from "@generated/models";
import { IsEnum, IsNotEmpty, IsOptional } from "class-validator"

export class CreateUserDto {
    @IsNotEmpty()
    fullName!: string;

    @IsNotEmpty()
    phone!: string;

    @IsEnum(UserType)
    type: UserType = UserType.CUSTOMER;

    constructor(obj: Partial<UserCreateInput>) {
        Object.assign(this, obj);
    }
}