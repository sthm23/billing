import { IsBoolean, isString, IsString, IsUUID } from "class-validator";

export class LogoutDto {
    @IsBoolean()
    allDevices: boolean = false;

    @IsString()
    sessionId!: string;
}