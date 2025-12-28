import { IsNotEmpty, IsString } from "class-validator";

export class CreateStoreDto {
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
    @IsString()
    name: string = ''

    constructor(dto: Partial<CreateStoreDto>) {
        Object.assign(this, dto)
    }
}
