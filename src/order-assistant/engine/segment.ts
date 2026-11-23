import { SEPARATOR_WORDS, Token, Word, tokenize } from './normalize';

/** New line, `;`, `!`, `?`, comma / dot outside a number (`0,4` and `0.4` stay). */
const CHUNK_SPLIT = /[\n\r;!?]+|,(?!\d)|(?<!\d),|\.(?!\d)|(?<!\d)\./;

/**
 * Text → phrases (one phrase = one product), docs/voice-order/DESIGN.md §4.1.
 * Splits on punctuation, on separator words (`va`, `yana`, `и`, `ещё`) and
 * before a word that starts another product name when the current phrase
 * already has a product name followed by something else
 * («shifer quvasoy metrovka 4x2» → 2 phrases, «oq kafel» stays one).
 */
export function segment(
  text: string,
  isNameWord: (word: Word) => boolean,
): Token[][] {
  const phrases: Token[][] = [];

  for (const chunk of text.split(CHUNK_SPLIT)) {
    let current: Token[] = [];
    let hasName = false;
    let previousIsName = false;
    const flush = () => {
      if (current.length > 0) phrases.push(current);
      current = [];
      hasName = false;
      previousIsName = false;
    };

    for (const token of tokenize(chunk)) {
      if (token.kind === 'word' && SEPARATOR_WORDS.has(token.word.text)) {
        flush();
        continue;
      }

      const isName = token.kind === 'word' && isNameWord(token.word);
      if (isName && hasName && !previousIsName) flush();

      current.push(token);
      hasName = hasName || isName;
      previousIsName = isName;
    }
    flush();
  }

  return phrases;
}
