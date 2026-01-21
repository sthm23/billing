import { PrismaClient } from "../../generated/prisma/client"


export async function seedCategories(prisma: PrismaClient) {
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
    return { electronics, phones, smartphones, laptops, fashion, men, women }
}