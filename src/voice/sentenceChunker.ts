import { stripSpecialTokens } from './gemmaToolParser';

// Blocks the user must never hear: tool calls, tool responses, thinking.
const HIDDEN_BLOCKS: [open: string, close: string][] = [
  ['<|tool_call>', '<tool_call|>'],
  ['<|tool_response>', '<tool_response|>'],
  ['<|channel>', '<channel|>'],
];

const SENTENCE_END = /[.!?…]+["')\]]*\s/;
const ABBREVIATIONS = /\b(mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e)\.\s$/i;
// Below this, a sentence is merged with the next to avoid choppy TTS.
const MIN_SENTENCE_CHARS = 12;
// A long clause without punctuation is flushed at a comma to keep latency low.
const MAX_CLAUSE_CHARS = 140;

function cleanForSpeech(text: string): string {
  return stripSpecialTokens(text)
    .replace(/[*_#`~>|]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ');
}

/**
 * Turns a raw LLM token stream into speakable sentences.
 * `push` returns the sentences completed by this token; `flush` returns the rest.
 */
export function createSentenceChunker() {
  let raw = '';
  let pending = '';

  const drainRaw = () => {
    // Drop complete hidden blocks; hold back anything after an unclosed opener.
    let out = '';
    for (;;) {
      let firstOpen = -1;
      let block: [string, string] | undefined;
      for (const b of HIDDEN_BLOCKS) {
        const i = raw.indexOf(b[0]);
        if (i !== -1 && (firstOpen === -1 || i < firstOpen)) {
          firstOpen = i;
          block = b;
        }
      }
      if (!block) {
        // Keep a possible partial opener (e.g. "<|tool") at the tail.
        const lt = raw.lastIndexOf('<');
        if (lt !== -1 && raw.indexOf('>', lt) === -1 && raw.length - lt < 18) {
          out += raw.slice(0, lt);
          raw = raw.slice(lt);
        } else {
          out += raw;
          raw = '';
        }
        return out;
      }
      out += raw.slice(0, firstOpen);
      const close = raw.indexOf(block[1], firstOpen + block[0].length);
      if (close === -1) {
        raw = raw.slice(firstOpen);
        return out;
      }
      raw = raw.slice(close + block[1].length);
    }
  };

  const take = (final: boolean): string[] => {
    const sentences: string[] = [];
    for (;;) {
      const match = SENTENCE_END.exec(pending);
      let cut = -1;
      if (match) {
        const end = match.index + match[0].length;
        if (!ABBREVIATIONS.test(pending.slice(0, end))) cut = end;
      }
      if (cut === -1 && pending.length > MAX_CLAUSE_CHARS) {
        const comma = pending.lastIndexOf(', ', MAX_CLAUSE_CHARS);
        if (comma > MIN_SENTENCE_CHARS) cut = comma + 2;
      }
      if (cut === -1) break;
      const sentence = pending.slice(0, cut).trim();
      if (sentence.length < MIN_SENTENCE_CHARS && !final) {
        // Too short on its own: wait for the next sentence and speak both.
        const next = SENTENCE_END.exec(pending.slice(cut));
        if (!next) break;
        cut += next.index + next[0].length;
      }
      sentences.push(pending.slice(0, cut).trim());
      pending = pending.slice(cut);
    }
    if (final) {
      const rest = pending.trim();
      if (/[\p{L}\p{N}]/u.test(rest)) sentences.push(rest);
      pending = '';
    }
    return sentences.filter((s) => /[\p{L}\p{N}]/u.test(s));
  };

  return {
    push(token: string): string[] {
      raw += token;
      pending += cleanForSpeech(drainRaw());
      return take(false);
    },
    flush(): string[] {
      // Whatever is left in `raw` is an unclosed hidden block or a stray '<'.
      const tail = raw.startsWith('<|') ? '' : raw;
      raw = '';
      pending += cleanForSpeech(tail);
      return take(true);
    },
    reset() {
      raw = '';
      pending = '';
    },
  };
}
