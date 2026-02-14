import { PrismaClient } from "../../generated/prisma/client";
import { AttributeType } from "../../generated/prisma/enums";

export async function seedAttributes(prisma: PrismaClient) {

    const attributes = [
        { name: 'Color', type: AttributeType.STRING },
        { name: 'Size', type: AttributeType.STRING },
        { name: 'RAM', type: AttributeType.NUMBER },
        { name: 'Storage', type: AttributeType.NUMBER },
        { name: 'Screen Size', type: AttributeType.NUMBER },
        { name: 'Material', type: AttributeType.STRING },
        { name: 'Gender', type: AttributeType.STRING },
        { name: 'Wood Species', type: AttributeType.STRING }, //порода древесины (сосна/ель/дуб)
        { name: 'Lumber Size', type: AttributeType.STRING }, //размер пиломатериалов 20×80 или 2×8
        { name: 'Length (m)', type: AttributeType.NUMBER }, //длина в метрах
        { name: 'Is New', type: AttributeType.BOOLEAN },
    ]
    const attrMap = new Map<string, string>();
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