import RNBlobUtil from 'react-native-blob-util';
import { scheduleOnRN } from 'react-native-worklets';
import { wrapAsync, type LLMModel } from 'react-native-executorch';
import {
  createChatPreprocessor,
  createLLMRunner,
  parseTokenizerConfig,
  type ChatMessage,
  type ChatMessageContent,
  type LLMGenerationConfig,
  type LLMKVCacheState,
  type LLMRunner,
  type Prompt,
  type ToolDefinition,
  type ToolParser,
} from 'react-native-executorch/llm';

export type ChatSessionOptions = {
  generationConfig: LLMGenerationConfig;
  stopRegex?: RegExp;
  /** End-of-turn tokens the tokenizer config does not list as eos (Gemma 3: `<end_of_turn>`). */
  extraStopTokens?: readonly string[];
  tools: readonly ToolDefinition[];
  parseToolCalls: ToolParser;
  maxToolTurns: number;
};

export type ChatSession = {
  /** Clears the KV cache and starts over from these messages. The model stays loaded. */
  reset(initialMessages: readonly ChatMessage[]): Promise<void>;
  sendMessage(message: string, onToken?: (token: string) => void): Promise<void>;
  stop(): void;
  getHistory(): readonly ChatMessage[];
  getKVCacheState(): LLMKVCacheState;
  dispose(): void;
};

function generateWorklet(
  runner: LLMRunner,
  prompt: Prompt,
  opts: {
    genConfig: LLMGenerationConfig;
    stopTokens: readonly string[];
    stopRegex?: RegExp;
    onToken?: (token: string) => void;
  },
): string {
  'worklet';
  let response = '';
  runner.generate(prompt, opts.genConfig, (token) => {
    if (opts.stopTokens.includes(token)) {
      runner.stop();
      return;
    }
    response += token;
    if (opts.onToken) scheduleOnRN(opts.onToken, token);
    if (opts.stopRegex?.test(response)) runner.stop();
  });
  return response;
}

/**
 * Same flow as the library's createLLMChatSession, but the runner (the ~2.6 GB
 * model) is loaded once and reused: a new conversation only rewinds the KV
 * cache instead of loading the weights again.
 */
export async function loadChatSession(config: LLMModel, opts: ChatSessionOptions): Promise<ChatSession> {
  const tokenizerConfig = parseTokenizerConfig(
    JSON.parse(await RNBlobUtil.fs.readFile(config.tokenizerConfigPath, 'utf8')),
  );
  const { chatTemplate } = tokenizerConfig;
  const stopTokens = [...tokenizerConfig.stopTokens, ...(opts.extraStopTokens ?? [])];
  const preprocessor = createChatPreprocessor({ chatTemplate, modalities: config.modalities, tools: opts.tools });

  let runner: LLMRunner;
  try {
    runner = await wrapAsync(createLLMRunner)(config.modelPath, config.tokenizerPath, config.modalities);
  } catch (e) {
    preprocessor.dispose();
    throw e;
  }
  const prefill = wrapAsync(runner.prefill);
  const generate = wrapAsync(generateWorklet);

  const history: ChatMessage[] = [];
  let committed = 0;
  let disposed = false;
  // Prefill, generate and reset all touch the same KV cache: run them one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  const prefillMessages = async (count: number) => {
    const prompt = preprocessor.process(history, count, { addGenPrompt: false });
    try {
      await prefill(prompt);
    } finally {
      preprocessor.clear();
    }
    committed = history.length;
  };

  const sendMessage = async (message: string, onToken?: (token: string) => void) => {
    if (disposed) return;
    const turnStart = history.length;
    const committedBefore = committed;
    const posBefore = runner.getKVCacheState().pos;
    history.push({ role: 'user', content: message });
    try {
      await prefillMessages(history.length - committed);
      const posAfterUser = runner.getKVCacheState().pos;
      const genOpts = { genConfig: opts.generationConfig, stopTokens, stopRegex: opts.stopRegex, onToken };

      for (let turn = 0; turn < opts.maxToolTurns; turn++) {
        const prompt = preprocessor.process(history, history.length - committed, { addGenPrompt: true });
        const response = await generate(runner, prompt, genOpts);
        preprocessor.clear();
        // Rewind so the reply (and tool results) are prefilled in clean template form.
        runner.reset(posAfterUser);

        const parsed = opts.parseToolCalls(response);
        if (!parsed || parsed.toolCalls.length === 0) {
          history.push({ role: 'assistant', content: response });
          break;
        }
        history.push({ role: 'assistant', content: parsed.textContent, toolCalls: parsed.toolCalls });
        for (const call of parsed.toolCalls) {
          const tool = opts.tools.find((t) => t.function.name === call.function.name);
          let content: ChatMessageContent;
          try {
            content = tool
              ? await tool.execute(call.function.arguments)
              : `Error: Tool '${call.function.name}' is not available.`;
          } catch (err) {
            content = `Error executing tool ${call.function.name}: ${String(err)}`;
          }
          history.push({ role: 'tool', toolCallId: call.id, name: call.function.name, content });
        }
      }

      if (history.length > committed) await prefillMessages(history.length - committed);
    } catch (err) {
      history.length = turnStart;
      committed = committedBefore;
      runner.reset(posBefore);
      preprocessor.clear();
      throw err;
    }
  };

  const reset = async (initialMessages: readonly ChatMessage[]) => {
    if (disposed) return;
    runner.reset(0);
    history.length = 0;
    committed = 0;
    history.push(...initialMessages);
    if (history.length) await prefillMessages(history.length);
  };

  return {
    reset: (messages) => enqueue(() => reset(messages)),
    sendMessage: (message, onToken) => enqueue(() => sendMessage(message, onToken)),
    stop: () => runner.stop(),
    getHistory: () => [...history],
    getKVCacheState: () => runner.getKVCacheState(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      runner.stop();
      // Let a running generate/prefill unwind before freeing the weights.
      void queue.then(() => {
        preprocessor.dispose();
        runner.dispose();
      });
    },
  };
}
