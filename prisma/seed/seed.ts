import { AttributeType, PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { seedBrands } from './brand.seed';
import { CategoryEnum, seedCategories } from './category.seed';
import { seedAttributes } from './attribute.seed';
import { seedUsers } from './user.seed';

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
    const categories = await seedCategories(prisma);
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
    const SMARTPHONES = categories.find(c => c.name === CategoryEnum.SMARTPHONES)!;
    const LAPTOPS = categories.find(c => c.name === CategoryEnum.LAPTOPS)!;
    const SHIRTS = categories.find(c => c.name === CategoryEnum.SHIRTS)!;
    const T_SHIRTS = categories.find(c => c.name === CategoryEnum.T_SHIRTS)!;
    const PANTS = categories.find(c => c.name === CategoryEnum.PANTS)!;
    const SHOES = categories.find(c => c.name === CategoryEnum.SHOES)!;
    const OUTERWEAR = categories.find(c => c.name === CategoryEnum.OUTERWEAR)!;
    const UNDERWEAR = categories.find(c => c.name === CategoryEnum.UNDERWEAR)!;
    const SOCKS = categories.find(c => c.name === CategoryEnum.SOCKS)!;
    const HATS = categories.find(c => c.name === CategoryEnum.HATS)!;
    const beam = categories.find(c => c.name === CategoryEnum.BEAM)!;
    const batten = categories.find(c => c.name === CategoryEnum.BATTEN)!;


    await prisma.categoriesOnAttribute.createMany({
        data: [
            // SMARTPHONES
            { categoryId: SMARTPHONES.id, attributeId: attrMap.get('Color')! },
            { categoryId: SMARTPHONES.id, attributeId: attrMap.get('RAM')! },
            { categoryId: SMARTPHONES.id, attributeId: attrMap.get('Storage')! },
            { categoryId: SMARTPHONES.id, attributeId: attrMap.get('Screen Size')! },
            { categoryId: SMARTPHONES.id, attributeId: attrMap.get('Is New')! },

            // LAPTOPS
            { categoryId: LAPTOPS.id, attributeId: attrMap.get('RAM')! },
            { categoryId: LAPTOPS.id, attributeId: attrMap.get('Storage')! },
            { categoryId: LAPTOPS.id, attributeId: attrMap.get('Screen Size')! },

            // Clothes
            { categoryId: SHIRTS.id, attributeId: attrMap.get('Size')! },
            { categoryId: SHIRTS.id, attributeId: attrMap.get('Color')! },
            { categoryId: SHIRTS.id, attributeId: attrMap.get('Gender')! },

            { categoryId: T_SHIRTS.id, attributeId: attrMap.get('Size')! },
            { categoryId: T_SHIRTS.id, attributeId: attrMap.get('Color')! },
            { categoryId: T_SHIRTS.id, attributeId: attrMap.get('Gender')! },

            { categoryId: PANTS.id, attributeId: attrMap.get('Size')! },
            { categoryId: PANTS.id, attributeId: attrMap.get('Color')! },
            { categoryId: PANTS.id, attributeId: attrMap.get('Gender')! },

            { categoryId: SHOES.id, attributeId: attrMap.get('Size')! },
            { categoryId: SHOES.id, attributeId: attrMap.get('Color')! },
            { categoryId: SHOES.id, attributeId: attrMap.get('Gender')! },

            { categoryId: OUTERWEAR.id, attributeId: attrMap.get('Size')! },
            { categoryId: OUTERWEAR.id, attributeId: attrMap.get('Color')! },
            { categoryId: OUTERWEAR.id, attributeId: attrMap.get('Gender')! },

            { categoryId: UNDERWEAR.id, attributeId: attrMap.get('Size')! },
            { categoryId: UNDERWEAR.id, attributeId: attrMap.get('Color')! },
            { categoryId: UNDERWEAR.id, attributeId: attrMap.get('Gender')! },

            { categoryId: SOCKS.id, attributeId: attrMap.get('Size')! },
            { categoryId: SOCKS.id, attributeId: attrMap.get('Color')! },
            { categoryId: SOCKS.id, attributeId: attrMap.get('Gender')! },

            { categoryId: HATS.id, attributeId: attrMap.get('Size')! },
            { categoryId: HATS.id, attributeId: attrMap.get('Color')! },
            { categoryId: HATS.id, attributeId: attrMap.get('Gender')! },

            // Lumber (Beam, Batten)
            { categoryId: beam.id, attributeId: attrMap.get('Wood Species')! },
            { categoryId: beam.id, attributeId: attrMap.get('Lumber Size')! },
            { categoryId: beam.id, attributeId: attrMap.get('Length (m)')! },

            { categoryId: batten.id, attributeId: attrMap.get('Wood Species')! },
            { categoryId: batten.id, attributeId: attrMap.get('Lumber Size')! },
            { categoryId: batten.id, attributeId: attrMap.get('Length (m)')! },

        ],
        skipDuplicates: true
    })
    console.log('✅ Seed completed successfully')
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
