import type { ToolCall, ToolParser } from 'react-native-executorch/llm';

/**
 * Gemma 4 emits tool calls in its own syntax (from the chat template in
 * tokenizer_config.json), not JSON:
 *
 *   <|tool_call>call:log_mood{mood:<|"|>sad<|"|>,intensity:3}<tool_call|>
 *
 * Strings are wrapped in the `<|"|>` escape token, keys are bare, and values
 * may be numbers, booleans, nested `{}` objects or `[]` arrays.
 */
const CALL_OPEN = '<|tool_call>';
const CALL_CLOSE = '<tool_call|>';
const QUOTE = '<|"|>';

/** Stops generation once a tool call is complete, so the session can run it. */
export const TOOL_CALL_STOP_REGEX = /<tool_call\|>/;

class Reader {
  pos = 0;
  constructor(private readonly s: string) {}

  skipWs() {
    while (this.pos < this.s.length && /\s/.test(this.s[this.pos]!)) this.pos++;
  }
  startsWith(token: string) {
    return this.s.startsWith(token, this.pos);
  }
  peek() {
    return this.s[this.pos];
  }

  value(): unknown {
    this.skipWs();
    if (this.startsWith(QUOTE)) {
      this.pos += QUOTE.length;
      const end = this.s.indexOf(QUOTE, this.pos);
      const str = this.s.slice(this.pos, end === -1 ? undefined : end);
      this.pos = end === -1 ? this.s.length : end + QUOTE.length;
      return str;
    }
    // Tolerate plain JSON-style quotes too.
    if (this.peek() === '"') {
      const end = this.s.indexOf('"', this.pos + 1);
      const str = this.s.slice(this.pos + 1, end === -1 ? undefined : end);
      this.pos = end === -1 ? this.s.length : end + 1;
      return str;
    }
    if (this.peek() === '{') return this.object();
    if (this.peek() === '[') return this.array();

    const start = this.pos;
    while (this.pos < this.s.length && !/[,}\]]/.test(this.s[this.pos]!)) this.pos++;
    const raw = this.s.slice(start, this.pos).trim();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    const n = Number(raw);
    return raw !== '' && !Number.isNaN(n) ? n : raw;
  }

  object(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.pos++; // {
    while (this.pos < this.s.length) {
      this.skipWs();
      if (this.peek() === '}') {
        this.pos++;
        break;
      }
      if (this.peek() === ',') {
        this.pos++;
        continue;
      }
      let key: string;
      if (this.startsWith(QUOTE) || this.peek() === '"') {
        key = String(this.value());
      } else {
        const colon = this.s.indexOf(':', this.pos);
        if (colon === -1) break;
        key = this.s.slice(this.pos, colon).trim();
        this.pos = colon;
      }
      this.skipWs();
      if (this.peek() === ':') this.pos++;
      out[key] = this.value();
    }
    return out;
  }

  array(): unknown[] {
    const out: unknown[] = [];
    this.pos++; // [
    while (this.pos < this.s.length) {
      this.skipWs();
      if (this.peek() === ']') {
        this.pos++;
        break;
      }
      if (this.peek() === ',') {
        this.pos++;
        continue;
      }
      out.push(this.value());
    }
    return out;
  }
}

function parseCallBody(body: string): ToolCall | undefined {
  const match = /^\s*call:([A-Za-z0-9_.-]+)\s*/.exec(body);
  if (!match) return undefined;
  const rest = body.slice(match[0].length);
  const args = rest.startsWith('{') ? new Reader(rest).object() : {};
  return { type: 'function', function: { name: match[1]!, arguments: args } };
}

let callCounter = 0;

export const parseGemmaToolCalls: ToolParser = (text) => {
  const toolCalls: ToolCall[] = [];
  let textContent = '';
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf(CALL_OPEN, cursor);
    if (open === -1) {
      textContent += text.slice(cursor);
      break;
    }
    textContent += text.slice(cursor, open);
    const bodyStart = open + CALL_OPEN.length;
    const close = text.indexOf(CALL_CLOSE, bodyStart);
    const body = text.slice(bodyStart, close === -1 ? undefined : close);
    const call = parseCallBody(body);
    if (call) toolCalls.push({ ...call, id: `call_${++callCounter}` });
    cursor = close === -1 ? text.length : close + CALL_CLOSE.length;
  }

  if (toolCalls.length === 0) return undefined;
  return { toolCalls, textContent: stripSpecialTokens(textContent).trim() };
};

/** Removes Gemma control tokens and thinking-channel blocks from spoken text. */
export function stripSpecialTokens(text: string): string {
  return text
    .replace(/<\|channel>[\s\S]*?<channel\|>/g, '')
    .replace(/<\|tool_response>[\s\S]*?<tool_response\|>/g, '')
    .replace(/<\|?[a-z_"]+\|?>/g, '');
}
