import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import {
  useSpeechToText,
  useTextToSpeech,
  useVoiceActivityDetector,
  type VadStreamOptions,
} from 'react-native-executorch';

import { forgetEverything, getMemory, memoryForPrompt } from './memoryStore';
import { LLM_MODEL, STT_MODEL, TTS_MODEL, VAD_MODEL } from './modelConfig';
import { PERSONAS, buildSystemPrompt, type PersonaId } from './persona';
import { createSentenceChunker } from './sentenceChunker';
import { HUM_SKILLS, callSignals } from './skills';
import { KV_COMPACT_RATIO, useBrain } from './useBrain';
import { MIC_SAMPLE_RATE, ensureMicPermission, useMic } from './useMic';
import { usePlayer } from './usePlayer';

export type LoopState = 'off' | 'starting' | 'listening' | 'thinking' | 'speaking';

export type TurnStats = {
  /** End of user speech → first LLM token, ms. */
  firstTokenMs: number;
  /** End of user speech → first audio enqueued, ms. Target < 1500. */
  firstAudioMs: number;
  totalMs: number;
};

// End-of-turn: how long the user must be quiet before Hum answers.
const LISTEN_VAD: VadStreamOptions = { minSilenceDurationMs: 650 };
// Barge-in is stricter so Hum's own voice (echo) does not trigger it.
const BARGE_IN_VAD: VadStreamOptions = { speechThreshold: 0.75, minSpeechDurationMs: 280 };
// Audio kept from before a barge-in is detected, so the first words are not lost.
const PREROLL_SAMPLES = MIC_SAMPLE_RATE * 0.8;

const GREETINGS = ["Hey. I'm here.", "Hi you. I'm listening.", 'Hey, how was your day?'];

// Weighted by approximate download size (GB).
const WEIGHTS = { llm: 2.6, stt: 0.15, tts: 0.33, vad: 0.002 };

export function useVoiceLoop(opts: { persona: PersonaId | undefined; enabled: boolean }) {
  const { persona: personaId, enabled } = opts;

  const [state, setState] = useState<LoopState>('off');
  const [lastStats, setLastStats] = useState<TurnStats | undefined>();
  const [loopError, setLoopError] = useState<string | undefined>();
  const stateRef = useRef<LoopState>('off');
  const setLoopState = useCallback((s: LoopState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  /** Mic loudness 0..1 (UI thread) and Hum's own output loudness. */
  const micLevel = useSharedValue(0);
  const outLevel = useSharedValue(0);

  const turnId = useRef(0);
  const llmBusy = useRef<Promise<unknown>>(Promise.resolve());
  const preroll = useRef<Float32Array[]>([]);
  const prerollLen = useRef(0);

  const stt = useSpeechToText(STT_MODEL, { preventLoad: !enabled });
  const tts = useTextToSpeech(TTS_MODEL, { preventLoad: !enabled });
  const vad = useVoiceActivityDetector(VAD_MODEL, { preventLoad: !enabled });
  const { synthesizeStop } = tts;
  const { streamStop } = stt;

  const brain = useBrain(LLM_MODEL, enabled, HUM_SKILLS);
  const { stop: stopGeneration } = brain;
  const player = usePlayer();
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const persona = personaId ? PERSONAS[personaId] : undefined;
  const systemPrompt = useCallback(() => (persona ? buildSystemPrompt(persona, memoryForPrompt()) : ''), [persona]);

  // Rebuild the conversation whenever the session or persona changes.
  const sessionPersona = useRef<PersonaId | undefined>(undefined);
  useEffect(() => {
    if (!brain.isDownloaded || !persona) return;
    sessionPersona.current = persona.id;
    void brain.reset(systemPrompt());
    // `brain.reset` changes identity with the downloaded resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brain.isDownloaded, brain.reset, persona?.id]);

  const isReady = stt.isReady && tts.isReady && vad.isReady && brain.isReady;
  const downloadProgress = useMemo(() => {
    const total = WEIGHTS.llm + WEIGHTS.stt + WEIGHTS.tts + WEIGHTS.vad;
    return (
      (brain.downloadProgress * WEIGHTS.llm +
        stt.downloadProgress * WEIGHTS.stt +
        tts.downloadProgress * WEIGHTS.tts +
        vad.downloadProgress * WEIGHTS.vad) /
      total
    );
  }, [brain.downloadProgress, stt.downloadProgress, tts.downloadProgress, vad.downloadProgress]);
  const modelError = brain.error ?? stt.error ?? tts.error ?? vad.error;

  // ---- speaking ---------------------------------------------------------

  /** Speaks sentences as they arrive. Resolves once everything has played. */
  const createSpeaker = useCallback(
    (id: number, onFirstAudio: () => void) => {
      const queue: string[] = [];
      let done = false;
      let wake: (() => void) | null = null;
      let firstAudio = false;
      const signal = () => {
        wake?.();
        wake = null;
      };

      const run = (async () => {
        while (turnId.current === id) {
          const sentence = queue.shift();
          if (sentence === undefined) {
            if (done) break;
            await new Promise<void>((r) => (wake = r));
            continue;
          }
          const style = persona?.voices[getMemory().voiceStyle] ?? PERSONAS.female.voices.warm;
          try {
            for await (const chunk of tts.synthesize!(sentence, { voice: style.voice, speed: style.speed })) {
              if (turnId.current !== id) return;
              player.enqueue(chunk.audio, chunk.sampleRate);
              outLevel.set(player.level);
              if (!firstAudio) {
                firstAudio = true;
                onFirstAudio();
                if (stateRef.current !== 'speaking') {
                  setLoopState('speaking');
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
                }
              }
            }
          } catch (e) {
            if (turnId.current !== id) return;
            if (__DEV__) console.warn('[hum] tts failed', e);
          }
        }
        if (turnId.current === id) await player.waitUntilIdle();
        outLevel.set(0);
      })();

      return {
        push(sentences: string[]) {
          if (sentences.length === 0) return;
          queue.push(...sentences);
          signal();
        },
        finish() {
          done = true;
          signal();
        },
        done: run,
      };
    },
    [persona, player, tts.synthesize, outLevel, setLoopState],
  );

  // ---- one turn ---------------------------------------------------------

  const respond = useCallback(
    async (id: number, userText: string, endOfSpeechAt: number) => {
      const session = brain.session.current;
      if (!session) return;
      setLoopState('thinking');
      void Haptics.selectionAsync();

      let firstTokenAt = 0;
      let firstAudioAt = 0;
      const chunker = createSentenceChunker();
      const speaker = createSpeaker(id, () => (firstAudioAt = Date.now()));

      // Never call the LLM while a cancelled turn is still unwinding (RESOURCE_BUSY).
      await llmBusy.current;
      if (turnId.current !== id) return;

      const generation = session.sendMessage(userText, (token) => {
        if (turnId.current !== id) return;
        if (!firstTokenAt) firstTokenAt = Date.now();
        speaker.push(chunker.push(token));
      });
      llmBusy.current = generation.catch(() => undefined);

      try {
        await generation;
      } catch (e) {
        if (turnId.current === id) throw e;
        return;
      }
      if (turnId.current !== id) return;
      speaker.push(chunker.flush());
      speaker.finish();
      await speaker.done;
      player.release();
      if (turnId.current !== id) return;

      const stats: TurnStats = {
        firstTokenMs: firstTokenAt ? firstTokenAt - endOfSpeechAt : -1,
        firstAudioMs: firstAudioAt ? firstAudioAt - endOfSpeechAt : -1,
        totalMs: Date.now() - endOfSpeechAt,
      };
      setLastStats(stats);
      if (__DEV__) console.log('[hum] turn.stats', stats, session.getKVCacheState());

      if (session.getKVCacheState().usageRatio > KV_COMPACT_RATIO) {
        await brain.compact(systemPrompt());
      }
    },
    [brain, createSpeaker, player, setLoopState, systemPrompt],
  );

  // ---- listening --------------------------------------------------------

  /** Streams mic audio into Whisper until the user finishes a sentence. */
  const listen = useCallback(
    async (id: number, withPreroll: boolean): Promise<string | null> => {
      setLoopState('listening');
      vad.resetStream?.();
      const gen = stt.stream!({ language: 'en', vadOptions: LISTEN_VAD });
      // The first next() runs the generator up to its first wait, which opens
      // the stream; only then are inserts accepted.
      let step = gen.next();
      if (withPreroll) preroll.current.forEach((f) => stt.streamInsert!(f));
      preroll.current = [];
      prerollLen.current = 0;

      let seenCommitted = '';
      let text: string | null = null;
      try {
        for (;;) {
          const { value, done } = await step;
          if (done) break;
          if (turnId.current !== id) {
            stt.streamStop!();
          } else if (value.nonCommitted === '' && value.committed.trim() && value.committed !== seenCommitted) {
            // A speech segment just closed: that's the end of the user's turn.
            text = value.committed.trim();
            stt.streamStop!();
          }
          seenCommitted = value.committed;
          step = gen.next();
        }
      } finally {
        await gen.return(undefined);
      }
      return turnId.current === id ? text : null;
    },
    [setLoopState, stt.stream, stt.streamInsert, stt.streamStop, vad],
  );

  const runLoop = useCallback(
    async (id: number, firstWithPreroll: boolean) => {
      let withPreroll = firstWithPreroll;
      try {
        while (turnId.current === id && !callSignals.endRequested) {
          const text = await listen(id, withPreroll);
          withPreroll = false;
          if (turnId.current !== id) return;
          if (!text) continue;
          await respond(id, text, Date.now());
        }
      } catch (e) {
        if (turnId.current !== id) return;
        setLoopError(e instanceof Error ? e.message : String(e));
        if (__DEV__) console.warn('[hum] loop error', e);
      }
      if (turnId.current === id && callSignals.endRequested) {
        void stopRef.current();
      }
    },
    [listen, respond],
  );

  // ---- barge-in & mic routing -------------------------------------------

  const bargeIn = useCallback(() => {
    const id = ++turnId.current;
    stopGeneration();
    synthesizeStop?.();
    player.interrupt();
    outLevel.set(0);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void runLoop(id, true);
  }, [outLevel, player, runLoop, stopGeneration, synthesizeStop]);

  const onFrame = useCallback(
    (frame: Float32Array, rms: number) => {
      micLevel.set(Math.min(1, rms * 8));
      outLevel.set(player.level);
      const s = stateRef.current;
      if (s === 'listening') {
        stt.streamInsert?.(frame);
        return;
      }
      if (s !== 'thinking' && s !== 'speaking') return;

      preroll.current.push(frame);
      prerollLen.current += frame.length;
      while (prerollLen.current > PREROLL_SAMPLES && preroll.current.length > 1) {
        prerollLen.current -= preroll.current.shift()!.length;
      }
      if (vad.detectVoiceOnStream?.(frame, BARGE_IN_VAD) === 'speechStart') bargeIn();
    },
    [bargeIn, micLevel, outLevel, player, stt, vad],
  );
  const mic = useMic(onFrame);

  // ---- public controls --------------------------------------------------

  const start = useCallback(async () => {
    if (!isReady || stateRef.current !== 'off') return;
    setLoopError(undefined);
    if (!(await ensureMicPermission())) {
      setLoopError('Hum needs the microphone to hear you.');
      return;
    }
    setLoopState('starting');
    callSignals.endRequested = false;
    const id = ++turnId.current;
    try {
      await mic.start();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // A short spoken hello, so the call feels answered.
      setLoopState('speaking');
      const speaker = createSpeaker(id, () => {});
      speaker.push([GREETINGS[Math.floor(Math.random() * GREETINGS.length)]!]);
      speaker.finish();
      await speaker.done;
      player.release();
    } catch (e) {
      setLoopError(e instanceof Error ? e.message : String(e));
      setLoopState('off');
      return;
    }
    if (turnId.current === id) void runLoop(id, false);
  }, [createSpeaker, isReady, mic, player, runLoop, setLoopState]);

  const stop = useCallback(async () => {
    turnId.current++;
    stopGeneration();
    streamStop?.();
    synthesizeStop?.();
    player.interrupt();
    await mic.stop();
    micLevel.set(0);
    outLevel.set(0);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoopState('off');
  }, [mic, micLevel, outLevel, player, setLoopState, stopGeneration, streamStop, synthesizeStop]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  /** Tap fallback: interrupt Hum, or end the user's turn early. */
  const tap = useCallback(() => {
    const s = stateRef.current;
    if (s === 'thinking' || s === 'speaking') bargeIn();
    else if (s === 'listening') streamStop?.();
  }, [bargeIn, streamStop]);

  const forget = useCallback(async () => {
    await forgetEverything();
    if (persona) await brain.reset(systemPrompt());
  }, [brain, persona, systemPrompt]);

  return {
    state,
    isReady,
    downloadProgress,
    modelError,
    loopError,
    lastStats,
    micLevel,
    outLevel,
    start,
    stop,
    tap,
    forget,
  };
}

export type VoiceLoop = ReturnType<typeof useVoiceLoop>;
