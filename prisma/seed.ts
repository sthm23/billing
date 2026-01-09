import { PrismaClient, AttributeType } from '@prisma/client';

const prisma = new PrismaClient()

async function main() {
    /**
     * ======================
     * BRANDS
     * ======================
     */
    const brands = [
        'Apple',
        'Samsung',
        'Xiaomi',
        'Huawei',
        'Lenovo',
        'HP',
        'Nike',
        'Adidas',
        'Loro Piano',
        'Hermes'
    ]

    await prisma.brand.createMany({
        data: brands.map(name => ({ name })),
        skipDuplicates: true,
    })

    /**
     * ======================
     * CATEGORIES
     * ======================
     */
    const electronics = await prisma.category.upsert({
        where: { name: 'Electronics' },
        update: {},
        create: { name: 'Electronics' },
    })

    const phones = await prisma.category.upsert({
        where: { name: 'Phones' },
        update: {},
        create: {
            name: 'Phones',
            parentId: electronics.id,
        },
    })

    const smartphones = await prisma.category.upsert({
        where: { name: 'Smartphones' },
        update: {},
        create: {
            name: 'Smartphones',
            parentId: phones.id,
        },
    })

    const laptops = await prisma.category.upsert({
        where: { name: 'Laptops' },
        update: {},
        create: {
            name: 'Laptops',
            parentId: electronics.id,
        },
    })

    const fashion = await prisma.category.upsert({
        where: { name: 'Fashion' },
        update: {},
        create: { name: 'Fashion' },
    })

    const men = await prisma.category.upsert({
        where: { name: 'Men' },
        update: {},
        create: {
            name: 'Men',
            parentId: fashion.id,
        },
    })

    const women = await prisma.category.upsert({
        where: { name: 'Women' },
        update: {},
        create: {
            name: 'Women',
            parentId: fashion.id,
        },
    })

    /**
     * ======================
     * ATTRIBUTES
     * ======================
     */
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
            where: { name: 'Is New' },
            update: {},
            create: { name: 'Is New', type: AttributeType.BOOLEAN },
        }),
    ])

    const attrMap = Object.fromEntries(
        attributes.map((a: any) => [a.name, a.id]),
    )

    /**
     * ======================
     * CATEGORY ↔ ATTRIBUTES
     * ======================
     */
    await prisma.categoryAttribute.createMany({
        data: [
            // Smartphones
            { categoryId: smartphones.id, attributeId: attrMap['Color'] },
            { categoryId: smartphones.id, attributeId: attrMap['RAM'] },
            { categoryId: smartphones.id, attributeId: attrMap['Storage'] },
            { categoryId: smartphones.id, attributeId: attrMap['Screen Size'] },
            { categoryId: smartphones.id, attributeId: attrMap['Is New'] },

            // Laptops
            { categoryId: laptops.id, attributeId: attrMap['RAM'] },
            { categoryId: laptops.id, attributeId: attrMap['Storage'] },
            { categoryId: laptops.id, attributeId: attrMap['Screen Size'] },

            // Clothes
            { categoryId: men.id, attributeId: attrMap['Size'] },
            { categoryId: men.id, attributeId: attrMap['Color'] },
            { categoryId: men.id, attributeId: attrMap['Gender'] },

            { categoryId: women.id, attributeId: attrMap['Size'] },
            { categoryId: women.id, attributeId: attrMap['Color'] },
            { categoryId: women.id, attributeId: attrMap['Gender'] },
        ],
        skipDuplicates: true,
    })

    console.log('✅ Seed completed successfully')
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
