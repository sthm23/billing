import { PrismaClient } from "../../generated/prisma/client";
import { AttributeEnum } from "./attribute.seed";

type AttributeValueData = string | number | boolean;
export async function seedAttributeValues(prisma: PrismaClient, attrMap: Map<AttributeEnum, string>) {
    await attributeValues(prisma, attrMap.get(AttributeEnum.COLOR)!, ['Red', 'Green', 'Blue', 'Black', 'White', 'Yellow', 'Pink', 'Purple', 'Gray', 'Brown', 'Orange']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.SIZE)!, ['S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.NUMBER_SIZE)!, [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45]);
    await attributeValues(prisma, attrMap.get(AttributeEnum.RAM)!, ['4GB', '8GB', '16GB', '32GB']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.STORAGE)!, ['128GB', '256GB', '512GB', '1TB']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.SCREEN_SIZE)!, ['13.3"', '14"', '15.6"', '17"']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.MATERIAL)!, ['Cotton', 'Polyester', 'Leather']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.GENDER)!, ['Male', 'Female', 'Unisex']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.WOOD_SPECIES)!, ['Pine', 'Spruce', 'Oak']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.LUMBER_SIZE)!, ['20×80', '2×8']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.LENGTH)!, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await attributeValues(prisma, attrMap.get(AttributeEnum.IS_NEW)!, [true, false]);
}


function attributeValues(prisma: PrismaClient, attributeId: string, values: AttributeValueData[]) {

    return prisma.attributeValue.createMany({
        data: values.map(value => ({
            valueBool: typeof value === 'boolean' ? value : undefined,
            valueNumber: typeof value === 'number' && !isNaN(Number(value)) ? Number(value) : undefined,
            valueString: typeof value === 'string' && isNaN(Number(value)) ? value : undefined,
            attributeId,
        })),
        skipDuplicates: true,
    })
}