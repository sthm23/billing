import { PrismaClient } from "../../generated/prisma/client";
import { AttributeType } from "../../generated/prisma/enums";

export enum AttributeEnum {
    COLOR = 'Color',
    SIZE = 'Size',
    NUMBER_SIZE = 'Number Size',
    // RAM = 'RAM',
    // STORAGE = 'Storage',
    // SCREEN_SIZE = 'Screen Size',
    WOOD_SPECIES = 'Wood Species',
    LUMBER_SIZE = 'Lumber Size',
    LENGTH = 'Length (m)',
}
export async function seedAttributes(prisma: PrismaClient): Promise<Map<AttributeEnum, string>> {

    const attributes = [
        { name: AttributeEnum.COLOR, type: AttributeType.STRING },
        { name: AttributeEnum.SIZE, type: AttributeType.STRING },
        { name: AttributeEnum.NUMBER_SIZE, type: AttributeType.NUMBER },
        { name: AttributeEnum.WOOD_SPECIES, type: AttributeType.STRING }, //порода древесины (сосна/ель/дуб)
        { name: AttributeEnum.LUMBER_SIZE, type: AttributeType.STRING }, //размер пиломатериалов 20×80 или 2×8
        { name: AttributeEnum.LENGTH, type: AttributeType.NUMBER }, //длина в метрах
    ]
    const attrMap = new Map<AttributeEnum, string>();
    for (const attr of attributes) {
        const attribute = await prisma.attribute.upsert({
            where: { name: attr.name },
            update: {},
            create: attr,
        })
        attrMap.set(attr.name, attribute.id);
    }

    return attrMap;
}