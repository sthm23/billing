import { AttributeType, PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { seedBrands } from './brand.seed';
import { seedCategories } from './category.seed';
import { seedAttributes } from './attribute.seed';

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
})

const prisma = new PrismaClient({
    adapter,
})


async function main() {
    /**
     * ======================
     * BRANDS
     * ======================
     */
    const brands = await seedBrands(prisma)
    /**
     * ======================
     * CATEGORIES
     * ======================
     */
    const {
        electronics, phones, smartphones,
        laptops, fashion, men, women
    } = await seedCategories(prisma);
    /**
     * ======================
     * ATTRIBUTES
     * ======================
     */
    const attrMap = await seedAttributes(prisma);

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
