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
        'Hermes',
        'Gucci',
        'Prada',
        'Zara',
        'H&M',
        'Uniqlo',
        'Puma',
        'Reebok',
        'Under Armour',
        'New Balance',
        'Asics'
    ]

    await prisma.brand.createMany({
        data: brands.map(name => ({ name })),
        skipDuplicates: true,
    })
}