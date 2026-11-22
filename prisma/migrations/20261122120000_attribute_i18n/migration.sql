-- Attributes: Russian names + uz/en translations (like categories), cleanup of English seed data.
-- See billing/docs/attribute-i18n/PLAN.md («Таблица переименований»). Keep in sync with
-- prisma/seed/attribute.seed.ts and attribute-value.seed.ts. Unknown rows are left untouched.

-- 1. New columns.
ALTER TABLE "attributes" ADD COLUMN "nameUz" TEXT,
ADD COLUMN "nameEn" TEXT;

-- 2. Rename: old (seed / prod) name → Russian name + translations; unit only where it was empty.
--    Skipped when the Russian name is already taken (name is unique).
UPDATE "attributes" a
SET "name" = m.ru, "nameUz" = m.uz, "nameEn" = m.en, "unit" = COALESCE(a."unit", m.unit)
FROM (VALUES
    ('Length (m)',     'Длина',              'Uzunlik',           'Length',            'м'),
    ('Lumber Size',    'Размер бруса',       'Brus o''lchami',     'Beam size',         NULL),
    ('Wood Species',   'Порода древесины',   'Yog''och turi',      'Wood species',      NULL),
    ('plywood',        'Толщина фанеры',     'Fanera qalinligi',  'Plywood thickness', 'см'),
    ('DSP',            'ДСП',                'DSP',               'Chipboard',         NULL),
    ('hardboard',      'Оргалит',            'Orgalit',           'Hardboard',         NULL),
    ('slate',          'Шифер',              'Shifer',            'Slate',             NULL),
    ('Tunika ranglar', 'Цвет профнастила',   'Tunika rangi',      'Sheet color',       NULL),
    ('Tunika razmer',  'Размер профнастила', 'Tunika o''lchami',   'Sheet size',        NULL),
    ('Color',          'Цвет',               'Rang',              'Color',             NULL),
    ('Size',           'Размер одежды',      'Kiyim o''lchami',    'Clothing size',     NULL),
    ('Number Size',    'Размер обуви',       'Poyabzal o''lchami', 'Shoe size',         NULL)
) AS m(old, ru, uz, en, unit)
WHERE a."name" = m.old
  AND NOT EXISTS (SELECT 1 FROM "attributes" x WHERE x."name" = m.ru);

-- 3. English seed values in use → Russian (values are not translated, see PLAN.md decision 2).
UPDATE "AttributeValue" v
SET "valueString" = m.ru
FROM "attributes" a,
(VALUES
    ('Цвет',             'Black', 'Чёрный'),
    ('Цвет',             'White', 'Белый'),
    ('Цвет',             'Blue',  'Синий'),
    ('Порода древесины', 'Pine',  'Сосна'),
    ('Порода древесины', 'Leaf',  'Лиственница')
) AS m(attr, old, ru)
WHERE v."attributeId" = a.id
  AND a."name" = m.attr
  AND v."valueString" = m.old
  AND NOT EXISTS (
    SELECT 1 FROM "AttributeValue" x
    WHERE x."attributeId" = v."attributeId" AND x."valueString" = m.ru
  );

-- 4. Remaining English seed values that no variant uses → delete.
DELETE FROM "AttributeValue" v
USING "attributes" a
WHERE v."attributeId" = a.id
  AND (
    (a."name" = 'Цвет' AND v."valueString" IN (
      'Red', 'Green', 'Blue', 'Black', 'White', 'Yellow', 'Pink', 'Purple',
      'Gray', 'Brown', 'Orange', 'Gold', 'Silver', 'Bronze', 'Olive', 'Coral'))
    OR (a."name" = 'Порода древесины' AND v."valueString" IN (
      'Leaf', 'Pine', 'Spruce', 'Oak', 'Walnut'))
  )
  AND NOT EXISTS (
    SELECT 1 FROM "variant_attribute_values" vav WHERE vav."attributeValueId" = v.id
  );

-- 5. Seed tags (clothing groups, New / Sale = true / false) are retired (PLAN.md decision 1).
--    On prod their only product links belong to the `test` store.
DELETE FROM "product_tag_values" ptv
USING "tag_values" tv, "tags" t
WHERE ptv."tagValueId" = tv.id
  AND tv."tagId" = t.id
  AND t."name" IN ('Material', 'Style', 'Occasion', 'Season', 'Pattern', 'New', 'Sale');

DELETE FROM "tag_values" tv
USING "tags" t
WHERE tv."tagId" = t.id
  AND t."name" IN ('Material', 'Style', 'Occasion', 'Season', 'Pattern', 'New', 'Sale');

DELETE FROM "tags" t
WHERE t."name" IN ('Material', 'Style', 'Occasion', 'Season', 'Pattern', 'New', 'Sale')
  AND NOT EXISTS (SELECT 1 FROM "tag_values" tv WHERE tv."tagId" = t.id);
