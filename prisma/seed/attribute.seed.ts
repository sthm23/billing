import { PrismaClient } from "../../generated/prisma/client";
import { AttributeType } from "../../generated/prisma/enums";

/** Attribute names: Russian, primary (unique). Translations — ATTRIBUTE_I18N. Keep in sync with
 *  migration 20261122120000_attribute_i18n. */
export enum AttributeEnum {
    COLOR = 'Цвет',
    SIZE = 'Размер одежды',
    NUMBER_SIZE = 'Размер обуви',
    SLATE = 'Шифер',
    PLYWOOD = 'Толщина фанеры',
    DSP = 'ДСП',
    HARDBOARD = 'Оргалит',
    WOOD_SPECIES = 'Порода древесины',
    LUMBER_SIZE = 'Размер бруса', // 2×3.5 или 2×8
    LENGTH = 'Длина',
}

const ATTRIBUTE_I18N: Record<AttributeEnum, { nameUz: string; nameEn: string }> = {
    [AttributeEnum.COLOR]: { nameUz: 'Rang', nameEn: 'Color' },
    [AttributeEnum.SIZE]: { nameUz: "Kiyim o'lchami", nameEn: 'Clothing size' },
    [AttributeEnum.NUMBER_SIZE]: { nameUz: "Poyabzal o'lchami", nameEn: 'Shoe size' },
    [AttributeEnum.SLATE]: { nameUz: 'Shifer', nameEn: 'Slate' },
    [AttributeEnum.PLYWOOD]: { nameUz: 'Fanera qalinligi', nameEn: 'Plywood thickness' },
    [AttributeEnum.DSP]: { nameUz: 'DSP', nameEn: 'Chipboard' },
    [AttributeEnum.HARDBOARD]: { nameUz: 'Orgalit', nameEn: 'Hardboard' },
    [AttributeEnum.WOOD_SPECIES]: { nameUz: "Yog'och turi", nameEn: 'Wood species' },
    [AttributeEnum.LUMBER_SIZE]: { nameUz: "Brus o'lchami", nameEn: 'Beam size' },
    [AttributeEnum.LENGTH]: { nameUz: 'Uzunlik', nameEn: 'Length' },
};

export async function seedAttributes(prisma: PrismaClient): Promise<Map<AttributeEnum, string>> {

    const attributes: { name: AttributeEnum; type: AttributeType; unit?: string }[] = [
        { name: AttributeEnum.COLOR, type: AttributeType.STRING },
        { name: AttributeEnum.SIZE, type: AttributeType.STRING },
        { name: AttributeEnum.NUMBER_SIZE, type: AttributeType.NUMBER },

        { name: AttributeEnum.SLATE, type: AttributeType.STRING }, // фирма и толщина 5-10 мм
        { name: AttributeEnum.PLYWOOD, type: AttributeType.NUMBER, unit: 'см' }, // 0.3, 0.4, 0.5, 0.6
        { name: AttributeEnum.DSP, type: AttributeType.STRING },
        { name: AttributeEnum.HARDBOARD, type: AttributeType.STRING },

        { name: AttributeEnum.WOOD_SPECIES, type: AttributeType.STRING }, // сосна / лиственница
        { name: AttributeEnum.LUMBER_SIZE, type: AttributeType.STRING },
        { name: AttributeEnum.LENGTH, type: AttributeType.NUMBER, unit: 'м' },
    ]
    const attrMap = new Map<AttributeEnum, string>();
    for (const attr of attributes) {
        const attribute = await prisma.attribute.upsert({
            where: { name: attr.name },
            update: {},
            create: { ...attr, ...ATTRIBUTE_I18N[attr.name] },
        })
        attrMap.set(attr.name, attribute.id);
    }

    return attrMap;
}
