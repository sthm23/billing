import {
  AliasHit,
  CatalogueVariant,
  MATCH_STATUS,
  MatchLine,
  buildIndex,
  matchPhrase,
  splitPhrases,
} from './matcher';

/** Warehouse `yogoch` of the local test DB (2026-11-23) + strapela variants with sizes. */
let seq = 0;
function v(
  productName: string,
  attrs: [string, string][],
  stock = 10,
): CatalogueVariant {
  seq++;
  return {
    variantId: `v${seq}`,
    productId: productName,
    productName,
    brandName: null,
    sku: `${productName}-${seq}`.toUpperCase(),
    barCode: String(200000000000 + seq),
    price: '50000',
    stock,
    attributes: attrs.map(([name, value]) => ({
      name,
      nameUz: null,
      nameEn: null,
      value,
    })),
  };
}

const CATALOGUE: CatalogueVariant[] = [
  v('argaletlar', [['Оргалит', 'Стандарт']]),
  v('despilar', [['ДСП', 'Термиз']]),
  v('despilar', [['ДСП', 'Премиум']]),
  v('fonerlar', [['Толщина фанеры', '0.4']], 0),
  v('fonerlar', [['Толщина фанеры', '0.6']]),
  v('fonerlar', [['Толщина фанеры', '0.3']]),
  v('fonerlar', [['Толщина фанеры', '0.5']]),
  v('metrovka', [
    ['Длина', '1'],
    ['Порода древесины', 'Сосна'],
    ['Размер бруса', '14x2'],
  ]),
  v('metrovka', [
    ['Длина', '1.5'],
    ['Порода древесины', 'Сосна'],
    ['Размер бруса', '14x2'],
  ]),
  v('metrovka', [
    ['Длина', '4'],
    ['Порода древесины', 'Сосна'],
    ['Размер бруса', '14x2'],
  ]),
  v('metrovka', [
    ['Длина', '2'],
    ['Порода древесины', 'Сосна'],
    ['Размер бруса', '14x2'],
  ]),
  v('polovoy', [
    ['Порода древесины', 'Сосна'],
    ['Размер бруса', '13x2'],
  ]),
  v('polovoy', [
    ['Порода древесины', 'Сосна'],
    ['Размер бруса', '5x4'],
  ]),
  v('shiferlar', [['Шифер', 'Бектемир']]),
  v('shiferlar', [['Шифер', 'Кувасой']]),
  v('shiferlar', [['Шифер', 'Охангарон']]),
  v('shiferlar', [['Шифер', 'Grand']]),
  v('shiferlar', [['Шифер', 'Master']]),
  v('shiferlar', [['Шифер', 'Super']]),
  v('shiferlar', [['Шифер', 'ЕВРО']]),
  v('shiferlar', [['Шифер', 'Олмалик']]),
  v('strapela', [
    ['Размер бруса', '4x6'],
    ['Длина', '6'],
  ]),
  v('strapela', [
    ['Размер бруса', '4x6'],
    ['Длина', '4'],
  ]),
  v('strapela', [
    ['Размер бруса', '4x8'],
    ['Длина', '6'],
  ]),
  v('strapela', [
    ['Размер бруса', '5x5'],
    ['Длина', '6'],
  ]),
];

const byLabel = (productName: string, ...values: string[]) =>
  CATALOGUE.find(
    (c) =>
      c.productName === productName &&
      values.every((value) => c.attributes.some((a) => a.value === value)),
  )!.variantId;

function match(
  text: string,
  aliases: Record<string, AliasHit[]> = {},
): MatchLine[] {
  const index = buildIndex(CATALOGUE);

  return splitPhrases(text, index).map((p) =>
    matchPhrase(p, index, aliases[p.key] ?? []),
  );
}

describe('order-assistant matcher', () => {
  it('matches the dictation example from the design (voice, no punctuation)', () => {
    const lines = match(
      "shifer quvasoy metrovka o'n to'rtga ikki to'rt metrli fonerlar nol olti strapela",
    );

    expect(lines.map((l) => l.phrase)).toEqual([
      'shifer quvasoy',
      "metrovka o'n to'rtga ikki to'rt metrli",
      'fonerlar nol olti',
      'strapela',
    ]);
    expect(lines[0].status).toBe(MATCH_STATUS.MATCHED);
    expect(lines[0].candidates[0].variantId).toBe(
      byLabel('shiferlar', 'Кувасой'),
    );
    expect(lines[1].status).toBe(MATCH_STATUS.MATCHED);
    expect(lines[1].candidates[0].variantId).toBe(
      byLabel('metrovka', '4', '14x2'),
    );
    expect(lines[2].status).toBe(MATCH_STATUS.MATCHED);
    expect(lines[2].candidates[0].variantId).toBe(byLabel('fonerlar', '0.6'));
    expect(lines[3].status).toBe(MATCH_STATUS.AMBIGUOUS);
    expect(lines[3].totalCandidates).toBe(4);
  });

  it("strapela to'rtga olti olti metrli → only 4x6 × 6 m", () => {
    const [line] = match("strapela to'rtga olti olti metrli");
    expect(line.status).toBe(MATCH_STATUS.MATCHED);
    expect(line.candidates).toHaveLength(1);
    expect(line.candidates[0].variantId).toBe(byLabel('strapela', '4x6', '6'));
  });

  it('numbers are strict: a size that does not exist is NOT_FOUND', () => {
    const [line] = match('strapela 4x7');
    expect(line.status).toBe(MATCH_STATUS.NOT_FOUND);
    expect(line.candidates).toEqual([]);
  });

  it('size without length → AMBIGUOUS between lengths', () => {
    const [line] = match('strapela 4 ga 6');
    expect(line.status).toBe(MATCH_STATUS.AMBIGUOUS);
    expect(line.candidates.map((c) => c.variantId).sort()).toEqual(
      [byLabel('strapela', '4x6', '6'), byLabel('strapela', '4x6', '4')].sort(),
    );
  });

  it('size said in the other order or without ga still fits', () => {
    expect(match('polovoy 4x5')[0].candidates[0].variantId).toBe(
      byLabel('polovoy', '5x4'),
    );
    expect(match("polovoy besh to'rt")[0].candidates[0].variantId).toBe(
      byLabel('polovoy', '5x4'),
    );
  });

  it('handles Cyrillic, plural and STT typos', () => {
    expect(match('шифер кувасой')[0].candidates[0].variantId).toBe(
      byLabel('shiferlar', 'Кувасой'),
    );
    expect(match('shiferlarni ohangaron')[0].candidates[0].variantId).toBe(
      byLabel('shiferlar', 'Охангарон'),
    );
    const typo = match('shfer olmaliq')[0];
    expect(typo.status).toBe(MATCH_STATUS.MATCHED);
    expect(typo.candidates[0].variantId).toBe(byLabel('shiferlar', 'Олмалик'));
  });

  it('returns out-of-stock candidates too (the client marks them)', () => {
    const [line] = match("foner nol to'rt");
    expect(line.status).toBe(MATCH_STATUS.MATCHED);
    expect(line.candidates[0].stock).toBe(0);
  });

  it('caps candidates at 5 and reports the total', () => {
    const [line] = match('shifer');
    expect(line.status).toBe(MATCH_STATUS.AMBIGUOUS);
    expect(line.candidates).toHaveLength(5);
    expect(line.totalCandidates).toBe(8);
  });

  it('unknown product → NOT_FOUND with the phrase kept', () => {
    const [line] = match('kafel oq');
    expect(line).toEqual({
      phrase: 'kafel oq',
      status: MATCH_STATUS.NOT_FOUND,
      candidates: [],
      totalCandidates: 0,
    });
  });

  it('splits typed text by lines and commas, and by va / и', () => {
    expect(
      match('shifer grand\nmetrovka 2 metr, despilar termiz').map(
        (l) => l.status,
      ),
    ).toEqual([
      MATCH_STATUS.MATCHED,
      MATCH_STATUS.MATCHED,
      MATCH_STATUS.MATCHED,
    ]);
    expect(match('shifer super va polovoy 13x2')).toHaveLength(2);
    expect(match('шифер супер и половой 13 на 2')).toHaveLength(2);
  });

  it('matches SKU and barcode exactly', () => {
    const target = CATALOGUE[10];
    expect(match(target.sku)[0].candidates[0].variantId).toBe(target.variantId);
    expect(match(target.barCode!)[0]).toMatchObject({
      status: MATCH_STATUS.MATCHED,
      candidates: [{ variantId: target.variantId, score: 1 }],
    });
  });

  it('a learned alias wins over fuzzy search', () => {
    const doska = byLabel('polovoy', '13x2');
    const [line] = match('taxta', {
      tahta: [{ variantId: doska, hits: 2, lastUsedAt: new Date() }],
    });
    expect(line.status).toBe(MATCH_STATUS.MATCHED);
    expect(line.candidates[0]).toMatchObject({ variantId: doska, score: 1 });
  });

  it('several aliases for one phrase → AMBIGUOUS, most used first', () => {
    const a = byLabel('polovoy', '13x2');
    const b = byLabel('polovoy', '5x4');
    const [line] = match('taxta', {
      tahta: [
        { variantId: a, hits: 1, lastUsedAt: new Date() },
        { variantId: b, hits: 3, lastUsedAt: new Date() },
      ],
    });
    expect(line.status).toBe(MATCH_STATUS.AMBIGUOUS);
    expect(line.candidates.map((c) => c.variantId)).toEqual([b, a]);
  });

  it('ignores an alias whose variant is no longer in the catalogue', () => {
    const [line] = match('taxta', {
      tahta: [
        { variantId: 'archived-variant', hits: 9, lastUsedAt: new Date() },
      ],
    });
    expect(line.status).toBe(MATCH_STATUS.NOT_FOUND);
  });
});
