import { PrismaClient, Category } from '../../generated/prisma/client';

/** System categories: level 1 = store direction, level 2 = product subcategory (no deeper levels). */
type CategorySeed = {
  name: string; // Russian, primary
  nameUz: string;
  nameEn: string;
};

type DirectionSeed = CategorySeed & { children: CategorySeed[] };

/**
 * Keep in sync with the name mapping in
 * prisma/migrations/20261113120000_category_two_levels/migration.sql.
 */
export const CATEGORY_TREE: DirectionSeed[] = [
  {
    name: 'Пиломатериалы',
    nameUz: "Yog'och materiallari",
    nameEn: 'Lumber',
    children: [
      { name: 'Балка', nameUz: 'Balka', nameEn: 'Beam' },
      { name: 'Брус', nameUz: 'Brus', nameEn: 'Timber' },
      { name: 'Рейка', nameUz: 'Reyka', nameEn: 'Batten' },
      {
        name: 'Кровельные материалы',
        nameUz: 'Tom yopish materiallari',
        nameEn: 'Roofing',
      },
      {
        name: 'Древесные плиты',
        nameUz: "Yog'och plitalar",
        nameEn: 'Wood Panels',
      },
    ],
  },
  {
    name: 'Электроника',
    nameUz: 'Elektronika',
    nameEn: 'Electronics',
    children: [
      { name: 'Телефоны', nameUz: 'Telefonlar', nameEn: 'Phones' },
      { name: 'Смартфоны', nameUz: 'Smartfonlar', nameEn: 'Smartphones' },
      { name: 'Ноутбуки', nameUz: 'Noutbuklar', nameEn: 'Laptops' },
    ],
  },
  {
    name: 'Мода',
    nameUz: 'Moda',
    nameEn: 'Fashion',
    children: [
      { name: 'Рубашки', nameUz: "Ko'ylaklar", nameEn: 'Shirts' },
      { name: 'Футболки', nameUz: 'Futbolkalar', nameEn: 'T-Shirts' },
      { name: 'Топы', nameUz: 'Toplar', nameEn: 'Tops' },
      { name: 'Платья', nameUz: 'Liboslar', nameEn: 'Dresses' },
      { name: 'Брюки', nameUz: 'Shimlar', nameEn: 'Pants' },
      { name: 'Юбки и шорты', nameUz: 'Yubka va shortilar', nameEn: 'Bottoms' },
      {
        name: 'Спортивная одежда',
        nameUz: 'Sport kiyimlari',
        nameEn: 'Sportswear',
      },
      { name: 'Верхняя одежда', nameUz: 'Ustki kiyimlar', nameEn: 'Outerwear' },
      { name: 'Нижнее бельё', nameUz: 'Ichki kiyimlar', nameEn: 'Underwear' },
      { name: 'Носки', nameUz: 'Paypoqlar', nameEn: 'Socks' },
      { name: 'Головные уборы', nameUz: 'Bosh kiyimlar', nameEn: 'Hats' },
      { name: 'Обувь', nameUz: 'Poyabzal', nameEn: 'Shoes' },
      { name: 'Кроссовки', nameUz: 'Krossovkalar', nameEn: 'Sneakers' },
      { name: 'Ботинки', nameUz: 'Etiklar', nameEn: 'Boots' },
      { name: 'Туфли', nameUz: 'Tuflilar', nameEn: 'Formal Shoes' },
      { name: 'Аксессуары', nameUz: 'Aksessuarlar', nameEn: 'Accessories' },
    ],
  },
];

/**
 * Find-or-create within the parent, matching the English key or the Russian name case-insensitively.
 * Existing rows are left as they are (an admin may have edited them).
 */
async function findOrCreate(
  prisma: PrismaClient,
  seed: CategorySeed,
  parentId: string | null,
): Promise<Category> {
  const existing = await prisma.category.findFirst({
    where: {
      parentId,
      OR: [
        { nameEn: { equals: seed.nameEn, mode: 'insensitive' } },
        { name: { equals: seed.name, mode: 'insensitive' } },
      ],
    },
  });
  if (existing) return existing;
  return prisma.category.create({ data: { ...seed, parentId } });
}

export async function seedCategories(prisma: PrismaClient) {
  const result: Category[] = [];
  for (const { children, ...direction } of CATEGORY_TREE) {
    const root = await findOrCreate(prisma, direction, null);
    result.push(root);
    for (const child of children) {
      result.push(await findOrCreate(prisma, child, root.id));
    }
  }
  return result;
}
