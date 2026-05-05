import { IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateCategoryAttributeDto {
    @IsNotEmpty()
    @IsString()
    name!: string;

    @IsOptional()
    @IsUUID('4')
    parentId?: string;
}
