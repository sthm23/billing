/**
 * Low-level text helpers of the order assistant (docs/voice-order/DESIGN.md §4):
 * Cyrillic → Latin, spelling folding, word similarity. Pure functions, no Nest.
 */

/** Uzbek Cyrillic letters first (ў, қ, ғ, ҳ), then Russian. `х` → `x` as in Uzbek Latin. */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: "o'",
  қ: 'q',
  ғ: "g'",
  ҳ: 'h',
};

/** All apostrophe look-alikes used in Uzbek Latin (o‘, gʻ, to'rt) → ASCII `'`. */
const APOSTROPHES = /[ʻʼ‘’`´ʹ′]/g;

/** Lower case, unified apostrophes, Cyrillic transliterated to Latin. */
export function toLatin(input: string): string {
  const lower = input.normalize('NFC').toLowerCase().replace(APOSTROPHES, "'");
  let out = '';
  for (const ch of lower) {
    out += CYRILLIC_TO_LATIN[ch] ?? ch;
  }
  return out;
}

/**
 * Spelling folding of one Latin word, applied to catalogue and phrase alike so
 * that common spelling / STT variants compare equal: apostrophes dropped
 * (to'rt → tort), q → k (Quvasoy = Кувасой), x / kh → h (Ohangaron = Охангарон),
 * w → v, leading ye → e (yevro = евро), doubled letters collapsed (sakkiz → sakiz).
 */
export function foldWord(word: string): string {
  return word
    .replace(/'/g, '')
    .replace(/kh/g, 'h')
    .replace(/q/g, 'k')
    .replace(/x/g, 'h')
    .replace(/w/g, 'v')
    .replace(/^ye/, 'e')
    .replace(/(.)\1+/g, '$1');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return set;
}

function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}

/**
 * Similarity of two folded words, 0…1: the better of edit-distance ratio and
 * trigram overlap; a typed prefix of ≥ 4 letters (`shif` → `shifer`) counts as
 * 0.75. Words shorter than 3 letters must be equal.
 */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  let score = Math.max(edit, trigramSimilarity(a, b));
  if (a.length >= 4 && b.startsWith(a)) score = Math.max(score, 0.75);
  return score;
}
