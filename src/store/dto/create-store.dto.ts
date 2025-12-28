import { IsNotEmpty } from "class-validator";

export class CreateStoreDto {
    @IsNotEmpty()
    fullName: string = ''

    @IsNotEmpty()
    phone: string = ''

    @IsNotEmpty()
    login: string = ''

    @IsNotEmpty()
    password: string = ''

    @IsNotEmpty()
    name: string = ''

    constructor(dto: Partial<CreateStoreDto>) {
        Object.assign(this, dto)
    }
}
