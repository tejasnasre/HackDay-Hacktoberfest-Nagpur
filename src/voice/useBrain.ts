import { useCallback, useEffect, useRef, useState } from 'react';
import { createLLMChatSession, useResourceDownload, type LLMChatSession, type LLMModel } from 'react-native-executorch';
import type { ChatMessage, ToolDefinition } from 'react-native-executorch/llm';

import { TOOL_CALL_STOP_REGEX, parseGemmaToolCalls, stripSpecialTokens } from './gemmaToolParser';

const MAX_NEW_TOKENS = 120;
const MAX_TOOL_TURNS = 2;
/** Above this KV-cache usage the session is rebuilt with a compact history. */
export const KV_COMPACT_RATIO = 0.8;
const CARRY_OVER_MESSAGES = 6;

/**
 * Gemma 4 chat session. Built imperatively (not with useLLMChatSession) so the
 * session can be rebuilt with a fresh system prompt when the persona changes
 * or the KV cache fills up.
 */
export function useBrain(config: LLMModel, enabled: boolean, tools: readonly ToolDefinition[]) {
  const { resource, downloadProgress, downloadError } = useResourceDownload(config, {
    preventLoad: !enabled,
  });
  const sessionRef = useRef<LLMChatSession | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const buildChain = useRef(Promise.resolve());

  const build = useCallback(
    (initialMessages: ChatMessage[]) => {
      if (!resource) return Promise.resolve();
      buildChain.current = buildChain.current.then(async () => {
        setIsReady(false);
        sessionRef.current?.dispose();
        sessionRef.current = null;
        try {
          sessionRef.current = await createLLMChatSession(resource, {
            initialMessages,
            generationConfig: { maxNewTokens: MAX_NEW_TOKENS, temperature: 0.8 },
            stopRegex: TOOL_CALL_STOP_REGEX,
            toolOpts: { tools, parseToolCalls: parseGemmaToolCalls, maxToolTurns: MAX_TOOL_TURNS },
          });
          setError(undefined);
          setIsReady(true);
        } catch (e) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      });
      return buildChain.current;
    },
    [resource, tools],
  );

  useEffect(
    () => () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    },
    [resource],
  );

  /** Interrupts the reply being generated, if any. */
  const stop = useCallback(() => sessionRef.current?.stop(), []);

  /** Starts a fresh conversation with this system prompt. */
  const reset = useCallback((systemPrompt: string) => build([{ role: 'system', content: systemPrompt }]), [build]);

  /** Keeps the last few spoken turns and drops the rest from the KV cache. */
  const compact = useCallback(
    (systemPrompt: string) => {
      const history = sessionRef.current?.getHistory() ?? [];
      const spoken: ChatMessage[] = [];
      for (const m of history) {
        if (m.role !== 'user' && m.role !== 'assistant') continue;
        if (typeof m.content !== 'string') continue;
        const content = stripSpecialTokens(m.content).trim();
        if (content) spoken.push(m.role === 'user' ? { role: 'user', content } : { role: 'assistant', content });
      }
      spoken.splice(0, Math.max(0, spoken.length - CARRY_OVER_MESSAGES));
      // The chat template needs a user turn first after the system prompt.
      while (spoken.length && spoken[0]!.role !== 'user') spoken.shift();
      return build([{ role: 'system', content: systemPrompt }, ...spoken]);
    },
    [build],
  );

  return {
    isDownloaded: !!resource,
    isReady,
    error: downloadError ?? error,
    downloadProgress,
    session: sessionRef,
    stop,
    reset,
    compact,
  };
}
