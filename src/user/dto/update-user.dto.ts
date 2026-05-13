import { IsNotEmpty, IsUUID } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto {
    password?: string;
}
export class UpdateCustomerDto {
    @IsNotEmpty()
    @IsUUID('4')
    orderId!: string;

    @IsNotEmpty()
    @IsUUID('4')
    customerId!: string;
}