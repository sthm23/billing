import { AttributeType } from "@generated/client";
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

/** Attribute names: Russian `name` (primary, unique) + optional uz / en translations. */
export const ATTRIBUTE_NAME_MIN = 2;
export const ATTRIBUTE_NAME_MAX = 60;

export class CreateAttributeDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(ATTRIBUTE_NAME_MAX)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(ATTRIBUTE_NAME_MAX)
    nameUz?: string;

    @IsOptional()
    @IsString()
    @MaxLength(ATTRIBUTE_NAME_MAX)
    nameEn?: string;

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

/** `PATCH /category/attribute/:id` (ADMIN) — an empty nameUz / nameEn clears the translation. The type never changes. */
export class UpdateAttributeDto {
    @IsOptional()
    @IsString()
    @MaxLength(200)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    nameUz?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    nameEn?: string;
}
