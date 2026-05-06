import { AttributeType } from "@generated/client";
import { IsEnum, IsNotEmpty, IsString, IsUUID } from "class-validator";

export class CreateAttributeDto {
    @IsNotEmpty()
    @IsString()
    name!: string;

    @IsNotEmpty()
    @IsEnum(AttributeType)
    type!: AttributeType;
}

export class CreateAttributeValueDto {
    @IsNotEmpty()
    @IsString()
    value!: string;

    @IsNotEmpty()
    @IsUUID('4')
    attributeId!: string;
}