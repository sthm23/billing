import { SignInDto } from './create-login.dto';

export class UpdatePasswordDto extends SignInDto {
    newPassword: string
}
