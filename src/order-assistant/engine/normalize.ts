import { foldWord, toLatin } from './text';

/**
 * Phrase normalization of the order assistant (docs/voice-order/DESIGN.md §4.2):
 * tokens, Uzbek / Russian number words → numbers, sizes (`to'rtga olti` → 4x6),
 * quantities and filler words dropped. The same tokenizer reads catalogue text.
 */

/** A word in folded form plus the form without an Uzbek suffix (shiferlar → shifer). */
export interface Word {
  text: string;
  stem: string;
}

/** Size such as 4x6 (order as said / stored). */
export type Dim = [number, number];

/** One analysed phrase (= one product the seller asked for). */
export interface Phrase {
  /** The phrase as the seller wrote / said it (tokens of the original text) */
  source: string;
  words: Word[];
  dims: Dim[];
  nums: number[];
  /** Canonical form; key of learned aliases (`VoiceAlias.phrase`) */
  key: string;
}

export type Token =
  | { kind: 'word'; source: string; word: Word; suffix: string | null }
  | {
      kind: 'num';
      source: string;
      value: number;
      suffix: string | null;
      /** Spelled as a word (`olti`), not digits — only those combine (`o'n ikki` = 12) */
      spelled: boolean;
    }
  | { kind: 'dim'; source: string; dim: Dim };

/** Folded spellings built from the readable lists below. */
function foldedMap(entries: [string[], number][]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [spellings, value] of entries) {
    for (const s of spellings) map.set(foldWord(toLatin(s)), value);
  }

  return map;
}

function foldedSet(words: string[]): Set<string> {
  return new Set(words.map((w) => foldWord(toLatin(w))));
}

/** Uzbek (incl. common STT spellings) and Russian number words. */
const NUMBER_WORDS = foldedMap([
  [['nol', 'nul', 'ноль', 'нуль'], 0],
  [['bir', 'один', 'одна', 'одно'], 1],
  [['ikki', 'два', 'две'], 2],
  [['uch', 'три'], 3],
  [["to'rt", 'turt', 'четыре'], 4],
  [['besh', 'пять'], 5],
  [['olti', 'шесть'], 6],
  [['yetti', 'etti', 'семь'], 7],
  [['sakkiz', 'восемь'], 8],
  [["to'qqiz", 'тўққиз', 'девять'], 9],
  [["o'n", 'десять'], 10],
  [['одиннадцать'], 11],
  [['двенадцать'], 12],
  [['тринадцать'], 13],
  [['четырнадцать'], 14],
  [['пятнадцать'], 15],
  [['шестнадцать'], 16],
  [['семнадцать'], 17],
  [['восемнадцать'], 18],
  [['девятнадцать'], 19],
  [['yigirma', 'двадцать'], 20],
  [["o'ttiz", 'тридцать'], 30],
  [['qirq', 'сорок'], 40],
  [['ellik', 'пятьдесят'], 50],
  [['oltmish', 'шестьдесят'], 60],
  [['yetmish', 'семьдесят'], 70],
  [['sakson', 'восемьдесят'], 80],
  [["to'qson", 'девяносто'], 90],
  [['yuz', 'сто'], 100],
  [['ming', 'тысяча'], 1000],
  [['yarim', 'половина', 'пол'], 0.5],
  [['полтора', 'полторы'], 1.5],
]);

const ZERO = 0;
const HALF = 0.5;
const MULTIPLIERS = new Set([100, 1000]);

/** Decimal point word: `bir butun besh` = 1.5. */
const DECIMAL_POINT = foldedSet(['butun', 'целых', 'целая']);
/** Between two numbers makes a size: `4 ga 6`, `4 на 6`, `4 x 6`. */
const DIM_SEPARATORS = foldedSet(['ga', 'na', 'на', 'x', 'х', '×', '*']);
/** After a number makes it a quantity (ignored in v1): `ikki dona`, `5 шт`. */
const QUANTITY_WORDS = foldedSet([
  'dona',
  'bitta',
  'bittasi',
  'ta',
  'shtuk',
  'штук',
  'штуки',
  'штука',
  'шт',
  'sht',
  'pachka',
  'пачка',
  'пачки',
]);
/** Units — the number stays, the word is dropped: `olti metrli` → 6. */
const UNIT_WORDS = foldedSet([
  'metr',
  'metrli',
  'metrlik',
  'metrik',
  'm',
  'метр',
  'метра',
  'метров',
  'метровый',
  'метровая',
  'м',
  'sm',
  'santimetr',
  'см',
  'сантиметр',
  'mm',
  'millimetr',
  'мм',
  'миллиметр',
  'kg',
  'kilo',
  'kilogramm',
  'кг',
  'кило',
  'килограмм',
  'gramm',
  'грамм',
  'г',
  'litr',
  'l',
  'литр',
  'литра',
  'литров',
  'л',
  'razmer',
  'размер',
  "o'lcham",
  "o'lchamli",
]);
/** Filler words of a request — never part of a product. */
const STOP_WORDS = foldedSet([
  'menga',
  'bizga',
  'kerak',
  'bering',
  'ber',
  'bervor',
  'beringlar',
  'iltimos',
  'ham',
  'endi',
  'bu',
  'shu',
  'mana',
  'uchun',
  'olaman',
  'olib',
  "qo'sh",
  "qo'shing",
  'yoz',
  'yozing',
  'bilan',
  'мне',
  'нам',
  'нужно',
  'надо',
  'нужен',
  'нужна',
  'дай',
  'дайте',
  'давай',
  'пожалуйста',
  'тоже',
  'это',
  'вот',
  'возьму',
  'запиши',
  'добавь',
]);
/** Words that separate products in speech: `shifer va metrovka`. */
export const SEPARATOR_WORDS = foldedSet([
  'va',
  'hamda',
  'keyin',
  'yana',
  'tagin',
  'и',
  'ещё',
  'еще',
  'потом',
  'плюс',
]);

/** The seller takes the last product back: `despilar standart, yo'q, premium`. */
export const CORRECTION_WORDS = foldedSet(["yo'q", 'нет']);

/** Longest first; a stem keeps ≥ 3 letters. `ta` only on number words (`oltita`). */
const SUFFIXES = [
  'lardan',
  'larni',
  'larga',
  'larda',
  'lari',
  'lar',
  'dan',
  'lik',
  'ni',
  'ga',
  'da',
  'li',
];
const NUMBER_SUFFIXES = ['ta', 'ga', 'li', 'lik', 'dan', 'da', 'ni'];
const MIN_STEM = 3;

function stripSuffix(
  word: string,
  suffixes: string[],
): { stem: string; suffix: string | null } {
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM) {
      return { stem: word.slice(0, -suffix.length), suffix };
    }
  }

  return { stem: word, suffix: null };
}

/** Number word with an optional suffix: `to'rtga` → 4 + `ga`, `oltita` → 6 + `ta`. */
function numberWord(
  folded: string,
): { value: number; suffix: string | null } | null {
  const direct = NUMBER_WORDS.get(folded);
  if (direct !== undefined) return { value: direct, suffix: null };

  for (const suffix of NUMBER_SUFFIXES) {
    if (folded.endsWith(suffix)) {
      const value = NUMBER_WORDS.get(folded.slice(0, -suffix.length));
      if (value !== undefined) return { value, suffix };
    }
  }

  return null;
}

const MIN_GLUED_PART = 2;

/**
 * A number word glued to another number word, a unit or a quantity word, as people type and
 * STT writes it: `o'nyettiga` → 10 + 7ga, `oltimetrlik` → 6 + metrlik, `uchpachka` → 3 + pachka. Splits only when the rest is
 * itself a number word or a unit, so product names stay whole.
 */
function splitGluedNumber(folded: string, source: string): Token[] | null {
  for (let cut = folded.length - MIN_GLUED_PART; cut >= MIN_GLUED_PART; cut--) {
    const head = NUMBER_WORDS.get(folded.slice(0, cut));
    if (head === undefined) continue;

    // Folded again: `ye` → `e` applies at a word start (`o'nyetti` → `yetti` → `eti`)
    const rest = foldWord(folded.slice(cut));
    const tail = numberWord(rest);
    if (tail) {
      return [
        { kind: 'num', source, value: head, suffix: null, spelled: true },
        { kind: 'num', source, ...tail, spelled: true },
      ];
    }
    if (UNIT_WORDS.has(rest) || QUANTITY_WORDS.has(rest)) {
      return [
        { kind: 'num', source, value: head, suffix: null, spelled: true },
        {
          kind: 'word',
          source,
          word: { text: rest, stem: rest },
          suffix: null,
        },
      ];
    }
  }

  return null;
}

const DIM_PATTERN = /^(\d+(?:\.\d+)?)[x×*](\d+(?:\.\d+)?)$/;
const NUM_PATTERN = /^\d+(?:\.\d+)?$/;
/** Splits `6m`, `4ga6`, `0.4sm` into number and letters; keeps `4x6`. */
const GLUED = /(\d)(?=[a-wyz']|x(?!\d))|([a-z'](?<!\dx))(?=\d)/g;

/** One raw token (already split on spaces) → 1..n tokens. */
function readRawToken(source: string): Token[] {
  const latin = toLatin(source).replace(/(\d),(\d)/g, '$1.$2');
  const tokens: Token[] = [];
  for (const piece of latin.replace(GLUED, '$1$2 ').split(' ')) {
    const part = piece.replace(/^[.']+|[.']+$/g, '');
    if (!part) continue;

    const dim = DIM_PATTERN.exec(part);
    if (dim) {
      tokens.push({
        kind: 'dim',
        source,
        dim: [Number(dim[1]), Number(dim[2])],
      });
      continue;
    }
    if (NUM_PATTERN.test(part)) {
      tokens.push({
        kind: 'num',
        source,
        value: Number(part),
        suffix: null,
        spelled: false,
      });
      continue;
    }

    const folded = foldWord(part);
    if (!folded) continue;

    const spelledNumber = numberWord(folded);
    if (spelledNumber) {
      tokens.push({ kind: 'num', source, ...spelledNumber, spelled: true });
      continue;
    }

    const glued = splitGluedNumber(folded, source);
    if (glued) {
      tokens.push(...glued);
      continue;
    }

    const { stem, suffix } = stripSuffix(folded, SUFFIXES);
    tokens.push({ kind: 'word', source, word: { text: folded, stem }, suffix });
  }

  return tokens;
}

/** Separators of raw tokens inside one chunk (dot / comma inside a number are kept). */
const TOKEN_SPLIT =
  /[\s;:!?()"«»[\]{}/\\|+=_—–-]+|,(?!\d)|(?<!\d),|\.(?!\d)|(?<!\d)\./;

/** Text → tokens with numbers combined (`o'n ikki` → 12, `nol to'rt` → 0.4, `bir yarim` → 1.5). */
export function tokenize(text: string): Token[] {
  const raw = text.split(TOKEN_SPLIT).filter(Boolean).flatMap(readRawToken);

  return combineNumbers(raw);
}

function isUnitDigit(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 9;
}

function isTens(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 10 && value <= 90 && value % 10 === 0
  );
}

function isDecimalPoint(token: Token | undefined): boolean {
  return token?.kind === 'word' && DECIMAL_POINT.has(token.word.text);
}

function combineNumbers(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind !== 'num' || !token.spelled) {
      out.push(token);
      i++;
      continue;
    }

    let value = token.value;
    let suffix = token.suffix;
    let source = token.source;
    i++;

    const next = (): Extract<Token, { kind: 'num' }> | null => {
      const t = tokens[i];

      return suffix === null && t?.kind === 'num' && t.spelled ? t : null;
    };
    const take = (t: Extract<Token, { kind: 'num' }>) => {
      suffix = t.suffix;
      source = `${source} ${t.source}`;
      i++;
    };

    if (value === ZERO) {
      // nol to'rt → 0.4
      const digit = next();
      if (digit && isUnitDigit(digit.value)) {
        value = digit.value / 10;
        take(digit);
      }
    } else {
      // ikki yuz yigirma besh → 225
      for (let t = next(); t; t = next()) {
        if (MULTIPLIERS.has(t.value) && value < t.value) value *= t.value;
        else if (
          isTens(t.value) &&
          (value % 100 === 0 || MULTIPLIERS.has(value))
        )
          value += t.value;
        else if (isUnitDigit(t.value) && value >= 10 && value % 10 === 0)
          value += t.value;
        else if (t.value === HALF && value !== HALF) value += HALF;
        else break;
        take(t);
      }
    }

    // bir butun besh → 1.5
    const afterPoint = tokens[i + 1];
    if (
      suffix === null &&
      isDecimalPoint(tokens[i]) &&
      afterPoint?.kind === 'num'
    ) {
      const digits = String(afterPoint.value).replace('.', '').length;
      value += afterPoint.value / 10 ** digits;
      source = `${source} ${tokens[i].source} ${afterPoint.source}`;
      suffix = afterPoint.suffix;
      i += 2;
    }

    out.push({ kind: 'num', source, value, suffix, spelled: true });
  }

  return out;
}

function isWord(token: Token | undefined, set: Set<string>): boolean {
  return (
    token?.kind === 'word' &&
    (set.has(token.word.text) || set.has(token.word.stem))
  );
}

export interface AnalyzeOptions {
  /**
   * Seller speech (default): a number before the first word, or followed by
   * `dona` / `-ta`, is a quantity and is dropped. Off for catalogue text.
   */
  speech?: boolean;
}

/** Tokens → words / sizes / numbers of one phrase. */
export function analyze(tokens: Token[], options: AnalyzeOptions = {}): Phrase {
  const speech = options.speech ?? true;
  const words: Word[] = [];
  const dims: Dim[] = [];
  const nums: number[] = [];
  const keyParts: string[] = [];
  let seenWord = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.kind === 'dim') {
      dims.push(token.dim);
      keyParts.push(`${token.dim[0]}x${token.dim[1]}`);
      continue;
    }

    if (token.kind === 'num') {
      // to'rtga olti / 4 ga 6 / 4 на 6 → 4x6
      const sepAfter =
        token.suffix === 'ga'
          ? 0
          : isWord(tokens[i + 1], DIM_SEPARATORS)
            ? 1
            : -1;
      const second = sepAfter >= 0 ? tokens[i + 1 + sepAfter] : undefined;
      if (second?.kind === 'num') {
        const dim: Dim = [token.value, second.value];
        dims.push(dim);
        keyParts.push(`${dim[0]}x${dim[1]}`);
        i += 1 + sepAfter;
        continue;
      }

      const isQuantity =
        speech &&
        (token.suffix === 'ta' ||
          isWord(tokens[i + 1], QUANTITY_WORDS) ||
          !seenWord);
      if (!isQuantity) {
        nums.push(token.value);
        keyParts.push(String(token.value));
      }
      continue;
    }

    const { word } = token;
    if (
      STOP_WORDS.has(word.text) ||
      SEPARATOR_WORDS.has(word.text) ||
      UNIT_WORDS.has(word.text) ||
      UNIT_WORDS.has(word.stem) ||
      QUANTITY_WORDS.has(word.text) ||
      DIM_SEPARATORS.has(word.text) ||
      DECIMAL_POINT.has(word.text)
    ) {
      continue;
    }

    seenWord = true;
    words.push(word);
    keyParts.push(word.stem);
  }

  return {
    source: tokens
      .map((t) => t.source)
      .filter((s, i, all) => s !== all[i - 1])
      .join(' '),
    words,
    dims,
    nums,
    key: keyParts.join(' '),
  };
}

/** Phrase text (as returned by `match`) → alias key; used by `feedback`. */
export function phraseKey(text: string): string {
  return analyze(tokenize(text)).key;
}
