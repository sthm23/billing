import { IsNotEmpty, IsEmail } from "class-validator";

export class CreateAdminDto {
    @IsNotEmpty()
    fullName!: string;

    @IsEmail()
    login!: string;

    @IsNotEmpty()
    password!: string;

    @IsNotEmpty()
    phone!: string;
}
