import { fetch } from 'expo/fetch';
import type {
  ChatMessage,
  LLMGenerationConfig,
  LLMKVCacheState,
  ToolDefinition,
} from 'react-native-executorch/llm';

import type { ChatSession } from './chatSession';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Soft context budget: past this the voice loop compacts history, like the on-device KV cache. */
const CONTEXT_BUDGET_TOKENS = 16_000;

type Part = {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  [key: string]: unknown;
};
type Content = { role: 'user' | 'model'; parts: Part[] };

export type GeminiSessionOptions = {
  apiKey: string;
  model: string;
  generationConfig: LLMGenerationConfig;
  tools: readonly ToolDefinition[];
  maxToolTurns: number;
};

function toContent(m: ChatMessage): Content | null {
  if (typeof m.content !== 'string' || !m.content.trim()) return null;
  if (m.role === 'user') return { role: 'user', parts: [{ text: m.content }] };
  if (m.role === 'assistant') return { role: 'model', parts: [{ text: m.content }] };
  return null;
}

function textOf(c: Content): string {
  return c.parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('');
}

/** Turns an API error body into something worth showing the user. */
async function describeError(res: Response): Promise<Error> {
  let message = `Gemini request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = `Gemini: ${body.error.message}`;
  } catch {
    // Keep the status-only message.
  }
  if (res.status === 400 && /api key/i.test(message)) message = 'Gemini: that API key is not valid.';
  return new Error(message);
}

/**
 * Same contract as the on-device session, backed by the Gemini API with the
 * user's own key. History is kept here and sent whole each turn; model parts
 * are stored verbatim so Gemini 3 thought signatures survive tool calls.
 */
export function createGeminiSession(opts: GeminiSessionOptions): ChatSession {
  let systemInstruction = '';
  const history: Content[] = [];
  let controller: AbortController | null = null;
  let disposed = false;

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  const tools = opts.tools.length
    ? [
        {
          functionDeclarations: opts.tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        },
      ]
    : undefined;

  /** Streams one model reply. Returns its parts, partial if stopped. */
  const generate = async (onToken?: (token: string) => void): Promise<{ parts: Part[]; aborted: boolean }> => {
    controller = new AbortController();
    const parts: Part[] = [];
    let aborted = false;
    try {
      const res = await fetch(`${API_URL}/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify({
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
          contents: history,
          tools,
          generationConfig: {
            maxOutputTokens: opts.generationConfig.maxNewTokens,
            temperature: opts.generationConfig.temperature,
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw await describeError(res as unknown as Response);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const chunk = JSON.parse(line.slice(5)) as { candidates?: { content?: { parts?: Part[] } }[] };
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            parts.push(part);
            if (part.text && !part.thought) onToken?.(part.text);
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) throw e;
      aborted = true;
    } finally {
      controller = null;
    }
    return { parts, aborted };
  };

  const sendMessage = async (message: string, onToken?: (token: string) => void) => {
    if (disposed) return;
    const turnStart = history.length;
    history.push({ role: 'user', parts: [{ text: message }] });
    try {
      for (let turn = 0; turn < opts.maxToolTurns; turn++) {
        const { parts, aborted } = await generate(onToken);
        const calls = parts.filter((p) => p.functionCall);
        if (aborted || calls.length === 0) {
          // Keep whatever was said before a barge-in, so the context stays honest.
          const reply = parts.filter((p) => p.text && !p.thought);
          if (reply.length) history.push({ role: 'model', parts: reply });
          return;
        }
        history.push({ role: 'model', parts });
        const responses: Part[] = [];
        for (const { functionCall: call } of calls) {
          const tool = opts.tools.find((t) => t.function.name === call!.name);
          let result: unknown;
          try {
            result = tool ? await tool.execute(call!.args ?? {}) : `Error: Tool '${call!.name}' is not available.`;
          } catch (err) {
            result = `Error executing tool ${call!.name}: ${String(err)}`;
          }
          responses.push({ functionResponse: { id: call!.id, name: call!.name, response: { result } } });
        }
        history.push({ role: 'user', parts: responses });
      }
      // Out of tool turns: one last reply without letting it call more tools.
      const { parts } = await generate(onToken);
      const reply = parts.filter((p) => p.text && !p.thought);
      if (reply.length) history.push({ role: 'model', parts: reply });
    } catch (err) {
      history.length = turnStart;
      throw err;
    }
  };

  const reset = async (initialMessages: readonly ChatMessage[]) => {
    if (disposed) return;
    history.length = 0;
    systemInstruction = initialMessages
      .filter((m) => m.role === 'system' && typeof m.content === 'string')
      .map((m) => m.content as string)
      .join('\n\n');
    for (const m of initialMessages) {
      const c = toContent(m);
      if (c) history.push(c);
    }
  };

  const getKVCacheState = (): LLMKVCacheState => {
    // Rough token estimate (~4 chars per token) so compaction still bounds cost and latency.
    const chars = systemInstruction.length + JSON.stringify(history).length;
    const pos = Math.ceil(chars / 4);
    return {
      pos,
      maxSeqLen: CONTEXT_BUDGET_TOKENS,
      remainingTokens: Math.max(0, CONTEXT_BUDGET_TOKENS - pos),
      usageRatio: Math.min(1, pos / CONTEXT_BUDGET_TOKENS),
    };
  };

  return {
    reset: (messages) => enqueue(() => reset(messages)),
    sendMessage: (message, onToken) => enqueue(() => sendMessage(message, onToken)),
    stop: () => controller?.abort(),
    getHistory: () =>
      history.flatMap((c): ChatMessage[] => {
        const content = textOf(c);
        if (!content) return [];
        return [c.role === 'user' ? { role: 'user', content } : { role: 'assistant', content }];
      }),
    getKVCacheState,
    dispose: () => {
      disposed = true;
      controller?.abort();
    },
  };
}
