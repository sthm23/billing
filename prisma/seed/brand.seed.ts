import { PrismaClient } from "../../generated/prisma/client";


export async function seedBrands(prisma: PrismaClient) {
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
}