import { PrismaClient } from "../../generated/prisma/client";
import { AttributeType } from "../../generated/prisma/enums";


export async function seedAttributes(prisma: PrismaClient) {
    const attributes = await Promise.all([
        prisma.attribute.upsert({
            where: { name: 'Color' },
            update: {},
            create: { name: 'Color', type: AttributeType.STRING },
        }),
        prisma.attribute.upsert({
            where: { name: 'Size' },
            update: {},
            create: { name: 'Size', type: AttributeType.STRING },
        }),
        prisma.attribute.upsert({
            where: { name: 'RAM' },
            update: {},
            create: { name: 'RAM', type: AttributeType.NUMBER },
        }),
        prisma.attribute.upsert({
            where: { name: 'Storage' },
            update: {},
            create: { name: 'Storage', type: AttributeType.NUMBER },
        }),
        prisma.attribute.upsert({
            where: { name: 'Screen Size' },
            update: {},
            create: { name: 'Screen Size', type: AttributeType.NUMBER },
        }),
        prisma.attribute.upsert({
            where: { name: 'Material' },
            update: {},
            create: { name: 'Material', type: AttributeType.STRING },
        }),
        prisma.attribute.upsert({
            where: { name: 'Gender' },
            update: {},
            create: { name: 'Gender', type: AttributeType.STRING },
        }),
        prisma.attribute.upsert({
            where: { name: 'Wood Species' }, //порода древесины (сосна/ель/дуб)
            update: {},
            create: { name: 'Wood Species', type: AttributeType.STRING },
        }),
        prisma.attribute.upsert({
            where: { name: 'Lumber Size' }, //размер пиломатериалов 20×80 или 2×8
            update: {},
            create: { name: 'Lumber Size', type: AttributeType.STRING },
        }),
        prisma.attribute.upsert({
            where: { name: 'Length (m)' }, //длина в метрах
            update: {},
            create: { name: 'Length (m)', type: AttributeType.NUMBER },
        }),
        prisma.attribute.upsert({
            where: { name: 'Is New' },
            update: {},
            create: { name: 'Is New', type: AttributeType.BOOLEAN },
        }),
    ])

    const attrMap = Object.fromEntries(
        attributes.map((a: any) => [a.name, a.id]),
    )

    return attrMap;
}