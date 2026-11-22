import { Prisma } from '@generated/client';

/**
 * Attribute label in every language (docs/attribute-i18n/PLAN.md): `name` is Russian (primary),
 * `nameUz` / `nameEn` are translations; the client picks one and falls back to `name`.
 */
export const ATTRIBUTE_LABEL_SELECT = {
  name: true,
  nameUz: true,
  nameEn: true,
} satisfies Prisma.AttributeSelect;
