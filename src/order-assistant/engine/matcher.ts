import { Dim, Phrase, Word, analyze, tokenize } from './normalize';
import { segment } from './segment';
import { toLatin, wordSimilarity } from './text';

/**
 * Phrase → catalogue candidates (docs/voice-order/DESIGN.md §4.3–4.5):
 * SKU / barcode → learned alias → fuzzy product name + strict numbers.
 * Pure: the service loads the warehouse catalogue and the aliases.
 */

export const MATCH_STATUS = {
  MATCHED: 'MATCHED',
  AMBIGUOUS: 'AMBIGUOUS',
  NOT_FOUND: 'NOT_FOUND',
} as const;
export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];

/** Same shape as `GET /product/search` attributes, so the client builds the cart line as usual. */
export interface CatalogueAttribute {
  name: string;
  nameUz: string | null;
  nameEn: string | null;
  value: string | null;
}

/** A sellable variant of the warehouse (canSell, product not archived). */
export interface CatalogueVariant {
  variantId: string;
  productId: string;
  productName: string;
  brandName: string | null;
  sku: string;
  barCode: string | null;
  /** Catalogue price, decimal string */
  price: string;
  /** Stock in this warehouse */
  stock: number;
  attributes: CatalogueAttribute[];
}

export interface MatchCandidate {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  barCode: string | null;
  price: string;
  stock: number;
  attributes: CatalogueAttribute[];
  /** 0…1; learned alias / SKU / barcode = 1 */
  score: number;
}

export interface MatchLine {
  phrase: string;
  status: MatchStatus;
  /** Best first, at most MAX_CANDIDATES */
  candidates: MatchCandidate[];
  /** All variants that fit (the client may offer «Найти вручную» when > candidates.length) */
  totalCandidates: number;
}

/** Learned alias rows of one phrase key. */
export interface AliasHit {
  variantId: string;
  hits: number;
  lastUsedAt: Date;
}

export const MAX_CANDIDATES = 5;
/** A phrase word is a product-name word from this similarity. */
const NAME_MIN = 0.72;
/** Other phrase words count as matched from this similarity. */
const WORD_MIN = 0.72;
/** A word starts a new phrase only if it is clearly a product name. */
const BOUNDARY_MIN = 0.8;
/** MATCHED needs this score and this lead over the next candidate. */
const MATCH_MIN = 0.75;
const MATCH_MARGIN = 0.15;
/** Phrase with numbers only (`14x2 1.5`): candidates are the variants with those numbers. */
const NUMBERS_ONLY_SCORE = 0.75;
const EXACT_SCORE = 1;
const EPSILON = 1e-6;
const BARCODE = /^\d{8,14}$/;

interface IndexedVariant {
  variant: CatalogueVariant;
  /** Product name + brand */
  nameWords: Word[];
  /** String attribute values */
  attrWords: Word[];
  nums: number[];
  dims: Dim[];
}

export interface CatalogueIndex {
  entries: IndexedVariant[];
  byId: Map<string, IndexedVariant>;
  bySku: Map<string, IndexedVariant>;
  byBarcode: Map<string, IndexedVariant>;
  nameVocabulary: Word[];
  /** Word similarity cache for one request */
  similarity: Map<string, number>;
}

function skuKey(value: string): string {
  return toLatin(value)
    .split(/[^a-z0-9.]+/)
    .filter(Boolean)
    .join(' ');
}

export function buildIndex(variants: CatalogueVariant[]): CatalogueIndex {
  const entries: IndexedVariant[] = [];
  const byId = new Map<string, IndexedVariant>();
  const bySku = new Map<string, IndexedVariant>();
  const byBarcode = new Map<string, IndexedVariant>();
  const vocabulary = new Map<string, Word>();

  for (const variant of variants) {
    const name = analyze(
      tokenize(`${variant.productName} ${variant.brandName ?? ''}`),
      {
        speech: false,
      },
    );
    const entry: IndexedVariant = {
      variant,
      nameWords: name.words,
      attrWords: [],
      nums: [...name.nums],
      dims: [...name.dims],
    };
    for (const attribute of variant.attributes) {
      if (attribute.value === null) continue;

      const value = analyze(tokenize(attribute.value), { speech: false });
      entry.attrWords.push(...value.words);
      entry.nums.push(...value.nums);
      entry.dims.push(...value.dims);
    }

    entries.push(entry);
    byId.set(variant.variantId, entry);
    bySku.set(skuKey(variant.sku), entry);
    if (variant.barCode) byBarcode.set(variant.barCode, entry);
    for (const word of name.words) vocabulary.set(word.text, word);
  }

  return {
    entries,
    byId,
    bySku,
    byBarcode,
    nameVocabulary: [...vocabulary.values()],
    similarity: new Map(),
  };
}

function similarity(index: CatalogueIndex, a: Word, b: Word): number {
  const cacheKey = `${a.text}|${b.text}`;
  const cached = index.similarity.get(cacheKey);
  if (cached !== undefined) return cached;

  const score = Math.max(
    wordSimilarity(a.text, b.text),
    wordSimilarity(a.stem, b.stem),
    wordSimilarity(a.stem, b.text),
    wordSimilarity(a.text, b.stem),
  );
  index.similarity.set(cacheKey, score);

  return score;
}

function bestSimilarity(
  index: CatalogueIndex,
  word: Word,
  candidates: Word[],
): number {
  let best = 0;
  for (const candidate of candidates) {
    best = Math.max(best, similarity(index, word, candidate));
    if (best === 1) break;
  }

  return best;
}

/** Text → analysed phrases, split on punctuation, separators and product-name boundaries. */
export function splitPhrases(text: string, index: CatalogueIndex): Phrase[] {
  const isNameWord = (word: Word) =>
    bestSimilarity(index, word, index.nameVocabulary) >= BOUNDARY_MIN;

  return segment(text, isNameWord)
    .map((tokens) => analyze(tokens))
    .filter((phrase) => phrase.key.length > 0 || BARCODE.test(phrase.source));
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** The variant has this size, in either order (4x6 = 6x4). */
function hasDim(entry: IndexedVariant, a: number, b: number): boolean {
  return entry.dims.some(
    ([x, y]) => (same(a, x) && same(b, y)) || (same(a, y) && same(b, x)),
  );
}

/**
 * Numbers and sizes match strictly: a phrase with 4x6 never matches 4x8 (DESIGN §4.3).
 * Two numbers said in a row without `ga` may be a size (`besh to'rt` = 5x4);
 * any other number must equal a numeric attribute (length, thickness).
 */
function numbersFit(phrase: Phrase, entry: IndexedVariant): boolean {
  if (!phrase.dims.every(([a, b]) => hasDim(entry, a, b))) return false;

  const rest = [...phrase.nums];
  for (let i = 0; i + 1 < rest.length; i++) {
    if (hasDim(entry, rest[i], rest[i + 1])) {
      rest.splice(i, 2);
      i--;
    }
  }

  return rest.every((n) => entry.nums.some((x) => same(n, x)));
}

function score(
  index: CatalogueIndex,
  phrase: Phrase,
  entry: IndexedVariant,
): number | null {
  if (!numbersFit(phrase, entry)) return null;
  if (phrase.words.length === 0) {
    return phrase.dims.length + phrase.nums.length > 0
      ? NUMBERS_ONLY_SCORE
      : null;
  }

  let nameScore = 0;
  let nameWordIndex = -1;
  phrase.words.forEach((word, i) => {
    const s = bestSimilarity(index, word, entry.nameWords);
    if (s > nameScore) {
      nameScore = s;
      nameWordIndex = i;
    }
  });
  if (nameScore < NAME_MIN) return null;

  let total = nameScore;
  phrase.words.forEach((word, i) => {
    if (i === nameWordIndex) return;

    const s = Math.max(
      bestSimilarity(index, word, entry.nameWords),
      bestSimilarity(index, word, entry.attrWords),
    );
    total += s >= WORD_MIN ? s : 0;
  });

  return total / phrase.words.length;
}

function label(variant: CatalogueVariant): string {
  return variant.attributes.map((a) => a.value ?? '').join(' ');
}

function toCandidate(variant: CatalogueVariant, value: number): MatchCandidate {
  return {
    variantId: variant.variantId,
    productId: variant.productId,
    productName: variant.productName,
    sku: variant.sku,
    barCode: variant.barCode,
    price: variant.price,
    stock: variant.stock,
    attributes: variant.attributes,
    score: Math.round(value * 100) / 100,
  };
}

function line(
  phrase: Phrase,
  status: MatchStatus,
  candidates: MatchCandidate[],
): MatchLine {
  return {
    phrase: phrase.source,
    status,
    candidates: candidates.slice(0, MAX_CANDIDATES),
    totalCandidates: candidates.length,
  };
}

export function matchPhrase(
  phrase: Phrase,
  index: CatalogueIndex,
  aliases: AliasHit[],
): MatchLine {
  // 1. SKU or barcode typed / said as is
  const exact =
    (BARCODE.test(phrase.source)
      ? index.byBarcode.get(phrase.source)
      : undefined) ?? index.bySku.get(skuKey(phrase.source));
  if (exact) {
    return line(phrase, MATCH_STATUS.MATCHED, [
      toCandidate(exact.variant, EXACT_SCORE),
    ]);
  }

  // 2. Learned aliases of this store (only variants still sellable in this warehouse)
  const aliased = aliases
    .filter((a) => index.byId.has(a.variantId))
    .sort(
      (a, b) =>
        b.hits - a.hits || b.lastUsedAt.getTime() - a.lastUsedAt.getTime(),
    )
    .map((a) => toCandidate(index.byId.get(a.variantId)!.variant, EXACT_SCORE));
  const aliasIds = new Set(aliased.map((c) => c.variantId));

  // 3. Fuzzy name + strict numbers
  const fuzzy = index.entries
    .filter((entry) => !aliasIds.has(entry.variant.variantId))
    .map((entry) => ({ entry, value: score(index, phrase, entry) }))
    .filter(
      (r): r is { entry: IndexedVariant; value: number } => r.value !== null,
    )
    .sort(
      (a, b) =>
        b.value - a.value ||
        Number(b.entry.variant.stock > 0) - Number(a.entry.variant.stock > 0) ||
        a.entry.variant.productName.localeCompare(
          b.entry.variant.productName,
        ) ||
        label(a.entry.variant).localeCompare(label(b.entry.variant)),
    )
    .map((r) => toCandidate(r.entry.variant, r.value));

  if (aliased.length > 0) {
    const status =
      aliased.length === 1 ? MATCH_STATUS.MATCHED : MATCH_STATUS.AMBIGUOUS;

    return line(phrase, status, [...aliased, ...fuzzy]);
  }
  if (fuzzy.length === 0) return line(phrase, MATCH_STATUS.NOT_FOUND, []);

  const [top, next] = fuzzy;
  const clear =
    top.score >= MATCH_MIN && (!next || top.score - next.score >= MATCH_MARGIN);

  return line(
    phrase,
    clear ? MATCH_STATUS.MATCHED : MATCH_STATUS.AMBIGUOUS,
    fuzzy,
  );
}
