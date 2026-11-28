/**
 * The 14 regions of Uzbekistan. The request stores the stable `code`; the names are
 * for the Mini App dropdown and for the store's employees (the district is free text).
 */
export const UZ_REGIONS = [
  { code: 'tashkent_city', ru: 'город Ташкент', uz: 'Toshkent shahri' },
  { code: 'tashkent_region', ru: 'Ташкентская область', uz: 'Toshkent viloyati' },
  { code: 'andijan', ru: 'Андижанская область', uz: 'Andijon viloyati' },
  { code: 'bukhara', ru: 'Бухарская область', uz: 'Buxoro viloyati' },
  { code: 'fergana', ru: 'Ферганская область', uz: 'Fargʻona viloyati' },
  { code: 'jizzakh', ru: 'Джизакская область', uz: 'Jizzax viloyati' },
  { code: 'khorezm', ru: 'Хорезмская область', uz: 'Xorazm viloyati' },
  { code: 'namangan', ru: 'Наманганская область', uz: 'Namangan viloyati' },
  { code: 'navoi', ru: 'Навоийская область', uz: 'Navoiy viloyati' },
  { code: 'kashkadarya', ru: 'Кашкадарьинская область', uz: 'Qashqadaryo viloyati' },
  { code: 'karakalpakstan', ru: 'Республика Каракалпакстан', uz: 'Qoraqalpogʻiston Respublikasi' },
  { code: 'samarkand', ru: 'Самаркандская область', uz: 'Samarqand viloyati' },
  { code: 'surkhandarya', ru: 'Сурхандарьинская область', uz: 'Surxondaryo viloyati' },
  { code: 'syrdarya', ru: 'Сырдарьинская область', uz: 'Sirdaryo viloyati' },
] as const;

export const REGION_CODES: readonly string[] = UZ_REGIONS.map((r) => r.code);

export function regionName(code: string): string {
  return UZ_REGIONS.find((r) => r.code === code)?.ru ?? code;
}
