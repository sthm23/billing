import {
  CORRECTION_WORDS,
  SEPARATOR_WORDS,
  Token,
  Word,
  tokenize,
} from './normalize';

/** Always a product boundary: new line, `;`, `!`, `?`. */
const CHUNK_SPLIT = /[\n\r;!?]+/;
/**
 * Comma / dot outside a number (`0,4` and `0.4` stay): a boundary only before a
 * product name — STT puts commas mid-product («palovoy to'rt metrli, yettiga ikki»).
 */
const SOFT_SPLIT = /,(?!\d)|(?<!\d),|\.(?!\d)|(?<!\d)\./;

/**
 * Text → phrases (one phrase = one product), docs/voice-order/DESIGN.md §4.1.
 * Splits on new lines / `;`, on a comma / dot before a part with a product name,
 * on separator words (`va`, `yana`, `и`, `ещё`) and
 * before a word that starts another product name when the current phrase
 * already has a product name followed by something else
 * («shifer quvasoy metrovka 4x2» → 2 phrases, «oq kafel» stays one).
 */
export function segment(
  text: string,
  isNameWord: (word: Word) => boolean,
): Token[][] {
  const phrases: Token[][] = [];
  // Name tokens of the last phrase that had one. A nameless phrase right after a separator word takes
  // them: «shifer quvasoy va super» → «shifer super». Elsewhere (a typo on its own line) it stays as is.
  let lastName: Token[] = [];
  let afterSeparator = false;

  for (const chunk of text.split(CHUNK_SPLIT)) {
    let current: Token[] = [];
    let nameTokens: Token[] = [];
    let hasName = false;
    let previousIsName = false;
    const flush = () => {
      if (current.length > 0) {
        if (hasName) lastName = nameTokens;
        phrases.push(
          hasName || !afterSeparator ? current : [...lastName, ...current],
        );
      }
      afterSeparator = false;
      current = [];
      nameTokens = [];
      hasName = false;
      previousIsName = false;
    };

    for (const part of chunk.split(SOFT_SPLIT)) {
      const tokens = tokenize(part);
      // A part without a product name continues the previous product
      if (tokens.some((t) => t.kind === 'word' && isNameWord(t.word))) flush();
      previousIsName = false;

      for (const token of tokens) {
        if (token.kind === 'word' && SEPARATOR_WORDS.has(token.word.text)) {
          flush();
          afterSeparator = true;
          continue;
        }
        // «despilar standart, yo'q, despilar premium»: the seller takes the last product back
        if (token.kind === 'word' && CORRECTION_WORDS.has(token.word.text)) {
          if (current.length > 0) {
            current = [];
            nameTokens = [];
            hasName = false;
            previousIsName = false;
          } else {
            phrases.pop();
          }
          continue;
        }

        const isName = token.kind === 'word' && isNameWord(token.word);
        // A new name closes the phrase: after another name + something (`shifer quvasoy | metrovka`),
        // or after a nameless phrase that follows `va` (`va super | despilar`; `oq kafel` stays one)
        const nameless = !hasName && afterSeparator && current.length > 0;
        if (isName && ((hasName && !previousIsName) || nameless)) flush();

        if (isName) nameTokens.push(token);
        current.push(token);
        hasName = hasName || isName;
        previousIsName = isName;
      }
    }
    flush();
  }

  return phrases;
}
