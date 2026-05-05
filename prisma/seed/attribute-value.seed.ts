import { PrismaClient } from "../../generated/prisma/client";
import { AttributeEnum } from "./attribute.seed";

type AttributeValueData = string | number | boolean;
export async function seedAttributeValues(prisma: PrismaClient, attrMap: Map<AttributeEnum, string>) {
    await attributeValues(prisma, attrMap.get(AttributeEnum.COLOR)!, [
        'Red', 'Green', 'Blue', 'Black', 'White', 'Yellow',
        'Pink', 'Purple', 'Gray', 'Brown', 'Orange', 'Gold',
        'Silver', 'Bronze', 'Olive', 'Coral'
    ]);
    await attributeValues(prisma, attrMap.get(AttributeEnum.SIZE)!, ['S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.NUMBER_SIZE)!, [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45]);
    // await attributeValues(prisma, attrMap.get(AttributeEnum.RAM)!, ['4GB', '8GB', '16GB', '32GB']);
    // await attributeValues(prisma, attrMap.get(AttributeEnum.STORAGE)!, ['128GB', '256GB', '512GB', '1TB']);
    // await attributeValues(prisma, attrMap.get(AttributeEnum.SCREEN_SIZE)!, ['13.3"', '14"', '15.6"', '17"']);

    await attributeValues(prisma, attrMap.get(AttributeEnum.SLATE)!, [
        'Охангарон', 'Олмалик', 'Кувасой', 'Grand',
        'Super', 'Master', 'Бектемир', 'ЕВРО'
    ]);
    await attributeValues(prisma, attrMap.get(AttributeEnum.PLYWOOD)!, [0.6, 0.5, 0.4, 0.3]);
    await attributeValues(prisma, attrMap.get(AttributeEnum.DSP)!, ['Термиз', 'Премиум']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.HARDBOARD)!, ['Стандарт']);

    await attributeValues(prisma, attrMap.get(AttributeEnum.WOOD_SPECIES)!, ['Leaf', 'Pine', 'Spruce', 'Oak', 'Walnut']);
    await attributeValues(prisma, attrMap.get(AttributeEnum.LUMBER_SIZE)!, [
        '4x2', '4x4.5',
        '5x5', '5x4',
        '7x1.5', '7x2', '7x4.5',
        '9x2', '9x2.5', '9x3.5', '9x4', '9x4.5',
        '10x2',
        '11x2', '11x2.5', '11x3.5', '11x4', '11x4.5',
        '12x4', '12.5x2',
        '13x2', '13x2.5',
        '14x2', '14x3.5', '14x3.8', '14x4', '14x4.5', '14x7',
        '15x2.5', '15x4.5', '15x5',
        '16x3.5', '16x4', '16x4.5',
        '17x2', '17x3.5', '17x4', '17x4.5',
        '18x5',
        '19x2', '19x3.5', '19x4', '19x4.5',
        '20x5',
        'кругляк',
    ]);
    await attributeValues(prisma, attrMap.get(AttributeEnum.LENGTH)!, [1, 1.5, 2, 4, 6]);
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