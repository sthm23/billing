import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { seedBrands } from './brand.seed';
import { seedCategories } from './category.seed';
import { seedAttributes } from './attribute.seed';
import { seedUsers } from './user.seed';
import { seedAttributeValues } from './attribute-value.seed';
import { seedTags } from './tag-seed';

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
})

const prisma = new PrismaClient({
    adapter,
})


async function main() {
    /**
     * ======================
     * USERS
     * ======================
     */
    await seedUsers(prisma);

    /* 
    Баркод генеруется первый раз
    */
    await prisma.barcodeSequence.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, nextCode: 200000000000n },
    });

    /**
     * ======================
     * BRANDS
     * ======================
     */
    await seedBrands(prisma)
    /**
     * ======================
     * CATEGORIES
     * ======================
     */
    await seedCategories(prisma);
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
    await seedAttributeValues(prisma, attrMap);

    /* Tags */
    await seedTags(prisma);

    console.log('✅ Seed completed successfully')
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
