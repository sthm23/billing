import { IsNotEmpty, IsString } from "class-validator";


export class IdParamDto {
    @IsNotEmpty()
    @IsString()
    attributeIds!: string;
}