import { PrismaClient, Category } from "../../generated/prisma/client";

type CategoryNode = {
    name: string;
    children: CategoryNode[];
};

export enum CategoryEnum {
    LUMBER = 'Lumber',
    BEAM = 'Beam',
    TIMBER = 'Timber',
    BATTEN = 'Batten',
    ROOFING = 'Roofing',
    WOOD_PANELS = 'Wood Panels',
    ELECTRONICS = 'Electronics',
    PHONES = 'Phones',
    SMARTPHONES = 'Smartphones',
    LAPTOPS = 'Laptops',
    FASHION = 'Fashion',
    MEN = 'Men',
    WOMEN = 'Women',
    SHIRTS = 'Shirts',
    T_SHIRTS = 'T-Shirts',
    SPORTS_WEAR = 'Sportswear',
    PANTS = 'Pants',
    SHOES = 'Shoes',
    SNEAKERS = 'Sneakers',
    BOOTS = 'Boots',
    FORMAL_SHOES = 'Formal Shoes',
    ACCESSORIES = 'Accessories',
    OUTERWEAR = 'Outerwear',
    UNDERWEAR = 'Underwear',
    SOCKS = 'Socks',
    HATS = 'Hats',
    DRESSES = 'Dresses',
    TOPS = 'Tops',
    BOTTOMS = 'Bottoms',
}
const categories: CategoryNode[] = [
    {
        name: CategoryEnum.LUMBER, // пиломатериалы древесины
        children: [
            {
                name: CategoryEnum.BEAM, // балка / Стропила / колонно 
                children: []
            },
            {
                name: CategoryEnum.TIMBER, // брус
                children: []
            },
            {
                name: CategoryEnum.BATTEN, // рейка
                children: []
            },
            {
                name: CategoryEnum.ROOFING, // Кровельные материалы (шифер, металлочерепица, профнастил и т.д.)
                children: []
            },
            {
                name: CategoryEnum.WOOD_PANELS, // Древесные плиты (фанера, ДСП, МДФ, OSB и т.д.)
                children: []
            }
        ]
    },
    {
        name: CategoryEnum.ELECTRONICS,
        children: [
            {
                name: CategoryEnum.PHONES,
                children: [
                    {
                        name: CategoryEnum.SMARTPHONES,
                        children: []
                    }
                ]
            },
            {
                name: CategoryEnum.LAPTOPS,
                children: []
            }]
    },
    {
        name: CategoryEnum.FASHION,
        children: [
            {
                name: CategoryEnum.MEN,
                children: [
                    {
                        name: CategoryEnum.SHIRTS,  // рубашки
                        children: []
                    },
                    {
                        name: CategoryEnum.T_SHIRTS, // футболки
                        children: []
                    },
                    {
                        name: CategoryEnum.PANTS, // брюки
                        children: []
                    },
                    {
                        name: CategoryEnum.SPORTS_WEAR, // спортивная одежда
                        children: []
                    },
                    {
                        name: CategoryEnum.SHOES, // обувь
                        children: [
                            {
                                name: CategoryEnum.SNEAKERS, // кроссовки
                                children: []
                            },
                            {
                                name: CategoryEnum.BOOTS, // ботинки
                                children: []
                            },
                            {
                                name: CategoryEnum.FORMAL_SHOES, // туфли
                                children: []
                            }
                        ]
                    },
                    {
                        name: CategoryEnum.ACCESSORIES, // аксессуары (ремни, часы, очки и т.д.)
                        children: []
                    },
                    {
                        name: CategoryEnum.OUTERWEAR,// верхняя одежда (Куртки, пальто, плащи и т.д.)
                        children: []
                    },
                    {
                        name: CategoryEnum.UNDERWEAR, // нижнее белье (трусы, бюстгальтеры, майки и т.д.)
                        children: []
                    },
                    {
                        name: CategoryEnum.SOCKS, // носки
                        children: []
                    },
                    {
                        name: CategoryEnum.HATS, // головные уборы (шляпы, кепки, банданы и т.д.)
                        children: []
                    }
                ]
            },
            {
                name: CategoryEnum.WOMEN,
                children: [
                    {
                        name: CategoryEnum.DRESSES, // платья
                        children: []
                    },
                    {
                        name: CategoryEnum.TOPS, // топы (блузки, майки, рубашки и т.д.)
                        children: []
                    },
                    {
                        name: CategoryEnum.BOTTOMS, // низ (юбки, брюки, шорты и т.д.)
                        children: []
                    },
                    {
                        name: CategoryEnum.SHOES, // обувь
                        children: [
                            {
                                name: CategoryEnum.SNEAKERS, // кроссовки
                                children: []
                            },
                            {
                                name: CategoryEnum.BOOTS, // ботинки
                                children: []
                            },
                            {
                                name: CategoryEnum.FORMAL_SHOES, // туфли
                                children: []
                            }
                        ]
                    },
                    {
                        name: CategoryEnum.ACCESSORIES, // аксессуары (ремни, часы, очки и т.д.)
                        children: []
                    },
                    {
                        name: CategoryEnum.OUTERWEAR, // верхняя одежда (Куртки, пальто, плащи и т.д.)
                        children: []
                    },
                    {
                        name: CategoryEnum.UNDERWEAR, // нижнее белье (трусы, бюстгальтеры, майки и т.д.)
                        children: []
                    },
                    {
                        name: CategoryEnum.SOCKS, // носки
                        children: []
                    },
                    {
                        name: CategoryEnum.HATS, // головные уборы (шляпы, кепки, банданы и т.д.)
                        children: []
                    }
                ]
            }
        ]
    },
]
export async function seedCategories(prisma: PrismaClient) {


    const result: Category[] = [];

    const createCategory = async (categories: CategoryNode[], parentId?: string) => {

        for (const category of categories) {
            const param = parentId ? { name: category.name, parentId: parentId } : { name: category.name }
            const createdCategory = await prisma.category.upsert({
                where: { name: category.name },
                update: {},
                create: param,
            });
            result.push(createdCategory);
            if (category.children.length > 0) {
                await createCategory(category.children, createdCategory.id)
            }

        }
    }
    await createCategory(categories)
    return result;
}