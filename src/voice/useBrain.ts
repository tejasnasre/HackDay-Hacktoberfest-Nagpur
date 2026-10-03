import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useResourceDownload, type LLMModel } from 'react-native-executorch';
import type { ChatMessage, ToolDefinition } from 'react-native-executorch/llm';

import { loadChatSession, type ChatSession } from './chatSession';
import { createGeminiSession } from './geminiSession';
import { TOOL_CALL_STOP_REGEX, parseGemmaToolCalls, stripSpecialTokens } from './gemmaToolParser';

const MAX_NEW_TOKENS = 120;
const MAX_TOOL_TURNS = 2;
/** Above this KV-cache usage the conversation is restarted with a compact history. */
export const KV_COMPACT_RATIO = 0.8;
const CARRY_OVER_MESSAGES = 6;
const GENERATION_CONFIG = { maxNewTokens: MAX_NEW_TOKENS, temperature: 0.8 };

/** Run the brain on Gemini instead of on-device Gemma. */
export type CloudBrain = { apiKey: string; model: string };

/**
 * Gemma 4 chat session. The model is loaded into memory once per download;
 * persona changes, "forget" and KV compaction only rewind the KV cache.
 * With `cloud` set, Gemini answers instead and Gemma is never downloaded.
 */
export function useBrain(
  config: LLMModel,
  enabled: boolean,
  tools: readonly ToolDefinition[],
  cloud: CloudBrain | undefined,
) {
  const { resource, downloadProgress, downloadError } = useResourceDownload(config, {
    preventLoad: !enabled || !!cloud,
  });
  const sessionRef = useRef<ChatSession | null>(null);
  // Tagged with the resource it was loaded from, so a stale (disposed) session is never used.
  const [loaded, setLoaded] = useState<{ from: LLMModel; session: ChatSession } | null>(null);
  const [readySession, setReadySession] = useState<ChatSession | null>(null);
  const [error, setError] = useState<Error | undefined>();

  const cloudKey = cloud?.apiKey;
  const cloudModel = cloud?.model;
  const cloudSession = useMemo(
    () =>
      enabled && cloudKey && cloudModel
        ? createGeminiSession({
            apiKey: cloudKey,
            model: cloudModel,
            generationConfig: GENERATION_CONFIG,
            tools,
            maxToolTurns: MAX_TOOL_TURNS,
          })
        : null,
    [enabled, cloudKey, cloudModel, tools],
  );
  useEffect(() => () => cloudSession?.dispose(), [cloudSession]);

  useEffect(() => {
    if (!resource || cloudKey) return;
    let alive = true;
    let deviceSession: ChatSession | null = null;
    if (__DEV__) console.log('[hum] llm: loading into memory');
    loadChatSession(resource, {
      generationConfig: GENERATION_CONFIG,
      stopRegex: TOOL_CALL_STOP_REGEX,
      tools,
      parseToolCalls: parseGemmaToolCalls,
      maxToolTurns: MAX_TOOL_TURNS,
    }).then(
      (session) => {
        if (!alive) return session.dispose();
        if (__DEV__) console.log('[hum] llm: loaded');
        deviceSession = session;
        setLoaded({ from: resource, session });
      },
      (e) => alive && setError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      alive = false;
      deviceSession?.dispose();
      setLoaded((l) => (l && l.session === deviceSession ? null : l));
    };
  }, [resource, tools, cloudKey]);

  const session = cloudSession ?? (!cloudKey && loaded && loaded.from === resource ? loaded.session : null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const build = useCallback(
    async (messages: ChatMessage[]) => {
      if (!session) return;
      try {
        if (__DEV__) console.log('[hum] llm: prefilling system prompt');
        await session.reset(messages);
        if (__DEV__) console.log('[hum] llm: ready', session.getKVCacheState());
        setError(undefined);
        setReadySession(session);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [session],
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
      // Merge back-to-back turns of the same role (e.g. after a barge-in).
      const turns: ChatMessage[] = [];
      for (const m of spoken) {
        const prev = turns[turns.length - 1];
        if (prev && prev.role === m.role) turns[turns.length - 1] = { ...prev, content: `${prev.content} ${m.content}` };
        else turns.push(m);
      }
      turns.splice(0, Math.max(0, turns.length - CARRY_OVER_MESSAGES));
      while (turns.length && turns[0]!.role !== 'user') turns.shift();
      // Must end on a model turn, so the next user message keeps alternation.
      if (turns.length && turns[turns.length - 1]!.role === 'user') turns.pop();
      return build([{ role: 'system', content: systemPrompt }, ...turns]);
    },
    [build],
  );

  return {
    /** True once the model is in memory and can take a system prompt. */
    isDownloaded: !!session,
    isReady: !!session && readySession === session,
    error: (cloud ? undefined : downloadError) ?? error,
    downloadProgress: cloud ? 100 : downloadProgress,
    session: sessionRef,
    stop,
    reset,
    compact,
  };
}
