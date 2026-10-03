# Hum on web: API-only voice companion (web pipeline plan)

## Context
Same app, same feel as mobile (`docs/PLAN.md`), but the web build runs **no local models at all**. `react-native-executorch` and `react-native-audio-api` are native modules — they don't compile to web — so every stage of the voice pipeline goes through an API. One Gemini key covers all three network stages (LLM + STT fallback + TTS), with free browser APIs as the default path where they exist. The stack is Expo SDK 57, RN 0.86, `expo-router`, `web.output: static`, `react-native-web` — all already in `package.json`. No dev build, no 3 GB download, deployable as a static site.

## Key findings (checked in this repo)
- **The brain already works on web.** `src/voice/geminiSession.ts` is plain `fetch` + SSE against `generativelanguage.googleapis.com` with the user's own key. No native code. It keeps history server-side-style (sent whole each turn), preserves thought signatures across tool turns, and emulates the KV-cache budget (`CONTEXT_BUDGET_TOKENS = 16_000`) so the loop's compaction logic behaves the same. Reuse it unchanged.
- **Skills are plain JS.** `src/voice/skills.ts` (`remember`/`recall`, `log_mood`/`mood_trend`, `set_voice_style`, `start_ritual`, `end_call`) and `src/voice/sentenceChunker.ts` have no native imports. Reuse unchanged. Same `maxToolTurns: 2`, same `callSignals.endRequested`.
- **Persona/system prompt unchanged.** `src/voice/persona.ts` builds the same spoken-style prompt. Only the voice table needs a web column (Gemini TTS voice names + `speechSynthesis` fallback, see below).
- **What must be replaced (native-only):** `useBrain.ts` (uses `useResourceDownload`), `useMic.ts` + `usePlayer.ts` (use `react-native-audio-api`), Whisper/Kokoro/FSMN-VAD hooks in `useVoiceLoop.ts`, and `memoryStore.ts` (MMKV + SecureStore). Each has a small browser equivalent below.
- **Expo web idiom:** ship these as `.web.ts` platform forks (`useMic.web.ts`, `usePlayer.web.ts`, `useBrain.web.ts`, `memoryStore.web.ts`) so `import './useMic'` resolves to the web version automatically and native files stay untouched.

## Recommended setup (all API / browser, zero downloads)
| Stage | Choice | Why |
|---|---|---|
| Mic + playback | Web Audio API: `getUserMedia` (echoCancellation + noiseSuppression) → `AudioContext`/`AudioWorklet` at 16 kHz | Same `onFrame(frame, rms)` contract as `useMic.ts`, so the loop doesn't change. Browser echo cancellation gives barge-in the same fighting chance as the `voiceChat` session mode |
| Turn detection | `@ricky0123/vad-web` (Silero VAD, ~2 MB wasm) with an RMS-energy fallback | Closest browser analogue to FSMN-VAD: real `speechStart`/`speechEnd` events. Same thresholds: ~650 ms silence for end-of-turn, strict threshold + ~280 ms min-speech for barge-in |
| STT (primary) | Web Speech API (`SpeechRecognition`, Chrome/Edge) | Free, streaming interim results → maps to Whisper's `nonCommitted`/`committed` for the live orb. No key, lowest latency |
| STT (fallback) | Record utterance → Gemini audio transcription (`inlineData` WAV → `gemini-2.0-flash` with a "transcribe verbatim" prompt) | Covers Firefox/Safari where Web Speech is missing. No extra vendor, same key |
| LLM | `createGeminiSession` as-is (default `gemini-3.5-flash-lite`, override via `EXPO_PUBLIC_GEMINI_MODEL`) | Zero new code. Same tools, same compaction at 0.8 usage ratio, same `MAX_NEW_TOKENS = 120` spoken replies |
| TTS (primary) | Gemini TTS (`gemini-2.5-flash-preview-tts`, 24 kHz PCM) per finished sentence | Same streaming shape as Kokoro: sentence in → audio chunk out → gapless enqueue. Voice per persona/style (below) |
| TTS (fallback) | `speechSynthesis` | Works with no key at all; pick closest en-US voice per persona. Robotic but instant — fine for dev |
| Memory | `localStorage` fork of `memoryStore.ts` (`hum.*` keys, same `HumData` shape and API) | MMKV/SecureStore don't exist on web. Limitation: no AES-256 without extra work (see Privacy) |

## Persona → voice map (web column to add in `persona.ts`)
| Persona | Style | Gemini TTS voice | speechSynthesis fallback |
|---|---|---|---|
| Mira (female) | warm / playful / calm | Sulaf / Kore / Zephyr (rate 1.0 / 1.08 / 0.9) | nearest en-US female, same rates |
| Kai (male) | warm / playful / calm | Charon / Puck / Fenrir (rate 1.0 / 1.08 / 0.9) | nearest en-US male, same rates |

Names are suggestions — pick whatever sounds best in a 5-minute listening test and lock them in.

## Voice loop (same states as mobile, browser inputs)
`off → starting → listening → thinking → speaking → (barge-in) listening`. Only the sources change:

1. **Listening.** Worklet emits 16 kHz frames (100 ms, like `FRAME_SAMPLES = 1600`) → feed VAD + STT. Web Speech `interim` results drive the "hearing you" orb (no text in UI, same as `nonCommitted`); `final` result, or VAD `speechEnd` + silence threshold on the fallback path, ends the turn. Keep the 0.8 s preroll ring buffer so barge-in never eats the first words.
2. **Thinking.** `session.sendMessage(text, onToken)` — the shared Gemini session. Same short persona prompt, no markdown/emoji, max ~120 tokens.
3. **Speaking.** Same `sentenceChunker`: each finished sentence → Gemini TTS (or `speechSynthesis.speak`) → `player.enqueue(pcm24k)`. First audio plays as soon as the first sentence resolves (same TTFA goal, < 1.5 s from end-of-speech).
4. **Barge-in.** VAD keeps running while speaking (browser echo cancellation + strict threshold so Hum's own voice doesn't trigger it). On `speechStart`: `session.stop()` (AbortController, already implemented), cancel TTS fetch, `player.interrupt()` (80 ms fade, same as native), back to listening with preroll.
5. **Tactile feel.** `expo-haptics` is a no-op on web — guard with `Platform.OS !== 'web'`. The Skia orb works on web via CanvasKit but is heavy; keep it (same component) and fall back to a Reanimated waveform if load time hurts. `micLevel`/`outLevel` shared values feed either.

## Privacy (this flips vs mobile — say it in onboarding)
- Mobile is on-device after download. **Web sends voice/audio/text to Google (Gemini + Web Speech) on every turn.** State this on the web onboarding screen next to the API-key field.
- Keep the good parts: never store audio, transcripts/memories only with opt-in (`rememberEnabled`), same "forget everything" button (clears `localStorage`), same crisis-helpline prompt line.
- `localStorage` is **not encrypted**. Either note it as a limitation or wrap values with WebCrypto AES-GCM (key in IndexedDB) — ~50 lines, do it only if time allows.

## Files to create (web forks; native files untouched)
- `docs/PLAN-WEB.md`: this plan.
- `src/voice/useWebBrain.ts` (or `useBrain.web.ts`): `createGeminiSession` + same `reset`/`compact`/`stop` surface as `useBrain.ts`, minus `useResourceDownload`. `downloadProgress` is always 100, `isReady` is true once the key is set.
- `src/voice/useMic.web.ts` + `src/voice/usePlayer.web.ts`: same exports (`MIC_SAMPLE_RATE`, `ensureMicPermission`, `useMic`; `usePlayer` with `enqueue/waitUntilIdle/release/interrupt/level`), built on `getUserMedia` + `AudioContext`.
- `src/voice/webVad.ts`: Silero-vad-web wrapper exposing `detectVoiceOnStream(frame)` → `speechStart/speechEnd/undefined`, plus RMS fallback. Same `LISTEN_VAD`/`BARGE_IN_VAD` constants.
- `src/voice/webStt.ts`: `WebSpeechStream` exposing `{ interim, final }` events matching Whisper's `{ nonCommitted, committed }`, plus `transcribeViaGemini(wav)` fallback.
- `src/voice/webTts.ts`: `synthesizeSentence(text, { voice, speed }) → AsyncGenerator<{ audio, sampleRate }>` (Gemini TTS) + `speechSynthesis` fallback. Same chunk shape Kokoro yields.
- `src/voice/memoryStore.web.ts`: `localStorage`-backed copy of the same API (`loadMemory`, `getMemory`, `updateMemory`, `rememberFact`, `recallFacts`, `logMood`, `moodsSince`, `forgetEverything`, `memoryForPrompt`).
- `src/voice/useVoiceLoop.web.ts`: copy of `useVoiceLoop.ts` with the five web modules swapped in; state machine, speaker queue, stats, and greeting logic identical.
- `src/voice/persona.ts`: add the web voice column (table above).
- `src/app/onboarding.tsx`: on web show API-key input + mic-permission button instead of the ~3 GB model download. Gate `APPROX_DOWNLOAD_GB` behind `Platform.OS !== 'web'`.

## Verification
- `bunx expo start --web`, test in Chrome (Web Speech path) plus one Firefox/Safari pass (Gemini STT fallback + `speechSynthesis` check).
- Same budgets as mobile: end-of-speech → first audio < 1.5 s (log `TurnStats`), barge-in stops audio < 200 ms without hearing itself, 20-turn conversation with stable memory and compaction triggering at 0.8.
- `bunx expo export --platform web` builds clean (static output); `bunx expo lint` and `bunx tsc --noEmit` before finishing.
