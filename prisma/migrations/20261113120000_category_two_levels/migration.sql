-- Categories: two levels (direction → subcategory), Russian names + uz/en translations,
-- uniqueness per parent (case-insensitive), createdBy audit. See billing/docs/categories/PLAN.md.

-- 1. Flatten: every category deeper than level 2 moves directly under its root.
--    Names are still globally unique here, so no conflicts inside a parent can appear.
WITH RECURSIVE tree AS (
    SELECT id, id AS root_id, 1 AS depth
    FROM "categories"
    WHERE "parentId" IS NULL
  UNION ALL
    SELECT c.id, t.root_id, t.depth + 1
    FROM "categories" c
    JOIN tree t ON c."parentId" = t.id
)
UPDATE "categories" c
SET "parentId" = t.root_id
FROM tree t
WHERE c.id = t.id AND t.depth > 2;

-- 2. Drop the former intermediate levels Men / Women (now childless).
--    Rows still referenced by products or stores are kept rather than losing data.
DELETE FROM "categories" c
WHERE c."name" IN ('Men', 'Women')
  AND c."parentId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "categories" ch WHERE ch."parentId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "products" p WHERE p."categoryId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "categories_on_stores" s WHERE s."categoryId" = c.id);

-- 3. New columns.
ALTER TABLE "categories" ADD COLUMN "nameUz" TEXT,
ADD COLUMN "nameEn" TEXT,
ADD COLUMN "createdById" TEXT;

ALTER TABLE "categories" ADD CONSTRAINT "categories_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. System names: English key → nameEn, Russian → name, Uzbek → nameUz.
--    Keep in sync with prisma/seed/category.seed.ts (CATEGORY_TREE). Unknown rows are untouched.
UPDATE "categories" c
SET "nameEn" = m.key, "name" = m.ru, "nameUz" = m.uz
FROM (VALUES
    ('Lumber',       'Пиломатериалы',        'Yog''och materiallari'),
    ('Beam',         'Балка',                'Balka'),
    ('Timber',       'Брус',                 'Brus'),
    ('Batten',       'Рейка',                'Reyka'),
    ('Roofing',      'Кровельные материалы', 'Tom yopish materiallari'),
    ('Wood Panels',  'Древесные плиты',      'Yog''och plitalar'),
    ('Electronics',  'Электроника',          'Elektronika'),
    ('Phones',       'Телефоны',             'Telefonlar'),
    ('Smartphones',  'Смартфоны',            'Smartfonlar'),
    ('Laptops',      'Ноутбуки',             'Noutbuklar'),
    ('Fashion',      'Мода',                 'Moda'),
    ('Shirts',       'Рубашки',              'Ko''ylaklar'),
    ('T-Shirts',     'Футболки',             'Futbolkalar'),
    ('Tops',         'Топы',                 'Toplar'),
    ('Dresses',      'Платья',               'Liboslar'),
    ('Pants',        'Брюки',                'Shimlar'),
    ('Bottoms',      'Юбки и шорты',         'Yubka va shortilar'),
    ('Sportswear',   'Спортивная одежда',    'Sport kiyimlari'),
    ('Outerwear',    'Верхняя одежда',       'Ustki kiyimlar'),
    ('Underwear',    'Нижнее бельё',         'Ichki kiyimlar'),
    ('Socks',        'Носки',                'Paypoqlar'),
    ('Hats',         'Головные уборы',       'Bosh kiyimlar'),
    ('Shoes',        'Обувь',                'Poyabzal'),
    ('Sneakers',     'Кроссовки',            'Krossovkalar'),
    ('Boots',        'Ботинки',              'Etiklar'),
    ('Formal Shoes', 'Туфли',                'Tuflilar'),
    ('Accessories',  'Аксессуары',           'Aksessuarlar')
) AS m(key, ru, uz)
WHERE c."name" = m.key;

-- 5. Uniqueness: per parent instead of global.
DROP INDEX "categories_name_key";

CREATE UNIQUE INDEX "categories_parentId_name_key" ON "categories"("parentId", "name");

-- Case-insensitive, per parent; roots separately because NULL parentIds are never equal.
-- Not representable in schema.prisma — maintained here by hand.
CREATE UNIQUE INDEX "categories_root_name_ci_key" ON "categories" (lower("name")) WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "categories_root_name_uz_ci_key" ON "categories" (lower("nameUz")) WHERE "parentId" IS NULL AND "nameUz" IS NOT NULL;
CREATE UNIQUE INDEX "categories_root_name_en_ci_key" ON "categories" (lower("nameEn")) WHERE "parentId" IS NULL AND "nameEn" IS NOT NULL;
CREATE UNIQUE INDEX "categories_child_name_ci_key" ON "categories" ("parentId", lower("name")) WHERE "parentId" IS NOT NULL;
CREATE UNIQUE INDEX "categories_child_name_uz_ci_key" ON "categories" ("parentId", lower("nameUz")) WHERE "parentId" IS NOT NULL AND "nameUz" IS NOT NULL;
CREATE UNIQUE INDEX "categories_child_name_en_ci_key" ON "categories" ("parentId", lower("nameEn")) WHERE "parentId" IS NOT NULL AND "nameEn" IS NOT NULL;
