/** «+998 90 123-45-67», «998901234567», «901234567» → «+998901234567»; anything else → null. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;

  return null;
}

/** 1234567 → «1 234 567» (plain spaces, so the text is the same on every device). */
export function formatAmount(value: string | number): string {
  const [whole, fraction] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  return fraction && Number(fraction) !== 0 ? `${grouped}.${fraction}` : grouped;
}

/** Attribute value as a person reads it: «6», «Красный», «да». */
export function attributeValueText(value: {
  valueString: string | null;
  valueNumber: { toString(): string } | null;
  valueBool: boolean | null;
}): string {
  if (value.valueString !== null) return value.valueString;
  if (value.valueNumber !== null) return value.valueNumber.toString();
  if (value.valueBool !== null) return value.valueBool ? 'да' : 'нет';

  return '';
}

/** «Strapela 6», «Футболка M Красный»: product name and the variant's attribute values. */
export function variantLabel(
  productName: string,
  attributes: {
    value: {
      valueString: string | null;
      valueNumber: { toString(): string } | null;
      valueBool: boolean | null;
    };
  }[],
): string {
  const options = attributes
    .map((a) => attributeValueText(a.value))
    .filter(Boolean)
    .join(' ');

  return [productName, options].filter(Boolean).join(' ');
}
