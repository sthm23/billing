import { PrismaClient } from "../../generated/prisma/client";


export async function seedTags(prisma: PrismaClient) {
    const tags = [
        { name: 'Material', values: ['Latex', 'Cotton', 'Polyester', 'Leather'] },
        { name: 'Style', values: ['Casual', 'Formal', 'Sport', 'Vintage'] },
        { name: 'Occasion', values: ['Wedding', 'Party', 'Work', 'Vacation'] },
        { name: 'Season', values: ['Spring', 'Summer', 'Fall', 'Winter'] },
        { name: 'Pattern', values: ['Solid', 'Striped', 'Plaid', 'Floral'] },
        { name: 'New', values: ['true', 'false'] },
        { name: 'Sale', values: ['true', 'false'] },
    ];

    for (const tag of tags) {
        await prisma.tag.upsert({
            where: { name: tag.name },
            update: {},
            create: {
                name: tag.name,
                values: {
                    createMany: {
                        data: tag.values.map(value => ({ value }))
                    }
                },
            },
        });
    }
}