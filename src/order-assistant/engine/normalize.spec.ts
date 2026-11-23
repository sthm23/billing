import { analyze, phraseKey, tokenize } from './normalize';
import { foldWord, toLatin, wordSimilarity } from './text';

const phrase = (text: string) => analyze(tokenize(text));

describe('order-assistant text', () => {
  it('transliterates Uzbek and Russian Cyrillic and unifies apostrophes', () => {
    expect(toLatin('Тўрт')).toBe("to'rt");
    expect(toLatin('Қувасой')).toBe('quvasoy');
    expect(toLatin('to‘rt')).toBe("to'rt");
    expect(toLatin('Сосна')).toBe('sosna');
  });

  it('folds spelling variants to one form', () => {
    expect(foldWord(toLatin('Кувасой'))).toBe(foldWord('quvasoy'));
    expect(foldWord(toLatin('Охангарон'))).toBe(foldWord('ohangaron'));
    expect(foldWord("to'qqiz")).toBe('tokiz');
  });

  it('scores STT typos high and different words low', () => {
    expect(wordSimilarity('shfer', 'shifer')).toBeGreaterThan(0.8);
    expect(wordSimilarity('metrofka', 'metrovka')).toBeGreaterThan(0.8);
    expect(wordSimilarity('strapela', 'shifer')).toBeLessThan(0.5);
    expect(wordSimilarity('oq', 'ok')).toBe(0);
  });
});

describe('order-assistant normalize', () => {
  it('strips Uzbek suffixes into the stem', () => {
    const p = phrase('shiferlarni');
    expect(p.words).toEqual([{ text: 'shiferlarni', stem: 'shifer' }]);
  });

  it("reads Uzbek sizes and lengths: to'rtga olti olti metrli → 4x6, 6", () => {
    const p = phrase("strapela to'rtga olti olti metrli");
    expect(p.dims).toEqual([[4, 6]]);
    expect(p.nums).toEqual([6]);
    expect(p.words.map((w) => w.stem)).toEqual(['strapela']);
    expect(p.key).toBe('strapela 4x6 6');
  });

  it('reads sizes written with digits, ga, на, ×, Cyrillic х', () => {
    expect(phrase('metrovka 14x2').dims).toEqual([[14, 2]]);
    expect(phrase('metrovka 14 ga 2').dims).toEqual([[14, 2]]);
    expect(phrase('metrovka 14ga2').dims).toEqual([[14, 2]]);
    expect(phrase('метровка 14 на 2').dims).toEqual([[14, 2]]);
    expect(phrase('метровка 14х2').dims).toEqual([[14, 2]]);
    expect(phrase('metrovka 14 × 2').dims).toEqual([[14, 2]]);
  });

  it("reads decimals: nol to'rt, 0,4, bir yarim, bir butun besh, полтора", () => {
    expect(phrase("foner nol to'rt").nums).toEqual([0.4]);
    expect(phrase('foner 0,4').nums).toEqual([0.4]);
    expect(phrase('metrovka bir yarim metrli').nums).toEqual([1.5]);
    expect(phrase('metrovka bir butun besh').nums).toEqual([1.5]);
    expect(phrase('метровка полтора метра').nums).toEqual([1.5]);
  });

  it('combines compound numbers but keeps two separate digits apart', () => {
    expect(phrase("kafel o'n ikki").nums).toEqual([12]);
    expect(phrase('kafel yigirma besh').nums).toEqual([25]);
    expect(phrase('kafel ikki yuz').nums).toEqual([200]);
    expect(phrase("polovoy besh to'rt").nums).toEqual([5, 4]);
    expect(phrase('четыре на шесть strapela').dims).toEqual([[4, 6]]);
  });

  it('drops quantities, units and filler words', () => {
    expect(phrase('ikkita shifer').nums).toEqual([]);
    expect(phrase('bitta shifer').words.map((w) => w.stem)).toEqual(['shifer']);
    expect(phrase('5 shifer').nums).toEqual([]);
    expect(phrase('shifer 3 dona').nums).toEqual([]);
    expect(phrase('shifer oltita').nums).toEqual([]);
    expect(phrase('menga shifer kerak').words.map((w) => w.stem)).toEqual([
      'shifer',
    ]);
    expect(
      phrase('мне нужен шифер пожалуйста').words.map((w) => w.text),
    ).toEqual(['shifer']);
  });

  it('keeps the original wording as the phrase source', () => {
    expect(phrase("Shifer Quvasoy to'rtga").source).toBe(
      "Shifer Quvasoy to'rtga",
    );
  });

  it('gives the same alias key for Latin and Cyrillic spellings', () => {
    expect(phraseKey('Шифер Кувасой')).toBe(phraseKey('shifer quvasoy'));
    expect(phraseKey('shiferlar quvasoydan')).toBe(phraseKey('shifer quvasoy'));
  });
});
