import { PrismaClient } from "../../generated/prisma/client";
import { AttributeType } from "../../generated/prisma/enums";

export enum AttributeEnum {
    COLOR = 'Color',
    SIZE = 'Size',
    NUMBER_SIZE = 'Number Size',
    // RAM = 'RAM',
    // STORAGE = 'Storage',
    // SCREEN_SIZE = 'Screen Size',
    SLATE = 'slate', // шифер 
    PLYWOOD = 'plywood', // фанера
    DSP = 'DSP', // ДСП
    HARDBOARD = 'hardboard', // оргалит
    WOOD_SPECIES = 'Wood Species', // порода древесины
    LUMBER_SIZE = 'Lumber Size', // размер пиломатериалов 2×3.5 или 2×8
    LENGTH = 'Length (m)', // длина в метрах
}
export async function seedAttributes(prisma: PrismaClient): Promise<Map<AttributeEnum, string>> {

    const attributes = [
        { name: AttributeEnum.COLOR, type: AttributeType.STRING },
        { name: AttributeEnum.SIZE, type: AttributeType.STRING },
        { name: AttributeEnum.NUMBER_SIZE, type: AttributeType.NUMBER },

        { name: AttributeEnum.SLATE, type: AttributeType.STRING }, //Шифер (фирма и толщина 5-10 мм)
        { name: AttributeEnum.PLYWOOD, type: AttributeType.NUMBER }, //фанера (0.3, 0.4, 0.5, 0.6)
        { name: AttributeEnum.DSP, type: AttributeType.STRING }, //ДСП
        { name: AttributeEnum.HARDBOARD, type: AttributeType.STRING }, //оргалит

        { name: AttributeEnum.WOOD_SPECIES, type: AttributeType.STRING }, //порода древесины (сосна/ель/дуб)
        { name: AttributeEnum.LUMBER_SIZE, type: AttributeType.STRING }, //размер пиломатериалов 2×3.5 или 2×8
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