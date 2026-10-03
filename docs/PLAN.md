# Hum: on-device voice companion (voice pipeline plan)

## Context
Hum is a voice-only companion app for single people, with a male or female persona, covering relationships and intimacy. Because the content is private, everything runs on the phone: no network calls after the models download. The stack is Expo SDK 57, RN 0.86, and `react-native-executorch@0.10.4`, which is already installed. The LLM is Gemma 4 E2B.

## Key findings (checked in docs and the installed package)
- **Gemma (3n or 4) can take raw audio as input according to Google: a USM-based encoder handles ASR and translation, with clips up to about 30 s. ExecuTorch can't use this yet.** `node_modules/react-native-executorch/lib/module/extensions/llm/utils/chatPreprocessor.js:239` throws `'Audio input not yet supported'`. Gemma 3n is not shipped at all.
- The only Gemma model is `models.llm.GEMMA4_E2B`, in three variants: `XNNPACK_8DA4W` (CPU, both platforms), `MLX_INT4` (iOS), and `VULKAN_8DA4W` (Android). Each is about 2.5–2.7 GB. It supports tool calling and multi-turn chat with an incremental KV cache.
- The pipeline therefore has to be **VAD → Whisper → Gemma 4 E2B (streamed) → Kokoro TTS (streamed per sentence)**.
- The docs offer these speech pieces:
  - `useSpeechToText`: Whisper with VAD built in. It provides `stream()`, `streamInsert()`, and `streamStop()` and returns `committed`/`nonCommitted` text. Input is 16 kHz.
  - `useVoiceActivityDetector`: FSMN-VAD, 1.8 MB, 2–5 ms per check. It provides `detectVoiceOnStream()` → `speechStart`/`speechEnd`.
  - `useTextToSpeech`: Kokoro at 24 kHz, about 332 MB, with an async generator that yields one chunk per sentence. Voices are `af_heart`, `af_sarah`, and `af_river` (female) and `am_michael` and `am_adam` (male). Stop it with `synthesizeStop()`.
- Requirements: a dev build (not Expo Go), the New Architecture, iOS 17+ and Android 13+, and worklets ≥0.10 (0.10.1 is installed). `react-native-audio-api` is **not installed** and is needed for the mic and for playback.
- Memory budget: Gemma about 2.6 GB, Whisper tiny.en about 60–220 MB, Kokoro about 330 MB, so roughly 3.2 GB of weights. **Target devices with 8 GB of RAM** (iPhone 15 Pro and later, Pixel 8 and later).

## What the "E2B" architecture gives us (Gemma 3n overview; Gemma 4 E2B is built the same way)
| Capability | What it is | Can we use it in this app? |
|---|---|---|
| **Effective parameters (E2B)** | More than 5B parameters in total, but it runs with about 1.9–2.3B in memory | Yes. This is why the ExecuTorch file is only about 2.5 GB (8-bit activations, 4-bit weights) |
| **PLE caching** | Per-layer embeddings are kept on fast storage instead of in RAM | Indirectly. ExecuTorch already takes care of the export |
| **Conditional parameter loading** | Audio and vision weights can be left out to save memory | Yes. The ExecuTorch build leaves them out, **which is why audio input isn't available** |
| **MatFormer** | Smaller models nested inside the bigger one (E4B contains E2B) | No. ExecuTorch only ships E2B |
| **Audio input** (ASR, translation, audio understanding) | Native speech recognition and translation | **Not with the built-in `GEMMA4_E2B` file (text-only). Possible with a custom upstream `gemma4.pte`; see "Native Gemma audio" below** |
| **Vision input** (MobileNet-V5) | Image understanding | Not needed (voice-only) |
| **140+ languages** | Multilingual chat | Yes, for a later Hindi or Hinglish version |
| **Long context** (3n: 32K, Gemma 4: 128K) | Long conversations | The exported max length can be lower. Read `getKVCacheState().maxSeqLen` while the app runs and size memory summarization from it |
| **Function calling** (Gemma 4) | Structured tool calls | Yes, for companion memory and mood (see below) |

## Can React Native ExecuTorch do Gemma 4 "Agent Skills"? (blog post from 2 Apr 2026)
The blog demos Agent Skills in **Google AI Edge Gallery, which runs on LiteRT-LM** and not on ExecuTorch. An "Agent Skill" is just **multi-step tool calling**: the model picks a tool, the app runs it, the result goes back to the model, and this repeats. ExecuTorch has that loop built in.

| Blog feature | LiteRT-LM | RN ExecuTorch 0.10.4 (checked in `node_modules`) |
|---|---|---|
| Multi-step tool calling / skills | Yes | **Yes.** `toolOpts: { tools, parseToolCalls, maxToolTurns }`. Each `ToolDefinition` has its own `execute()`, and the session loops automatically (`llmChatSession.d.ts`) |
| Gemma 4 tool-call parser | Built in | **We write it.** `ToolParser = (text) => {toolCalls, textContent}`. No parser comes with the library. Copy the call format from the Gemma 4 `tokenizer_config.json` chat template |
| Skills that call other models (TTS, images) | Yes | **Yes.** `execute()` is ordinary JS, so it can call Kokoro, Whisper, embeddings, and so on |
| Constrained decoding (guaranteed JSON) | Yes | **No.** Only prompt-and-repair (legacy `fixAndValidateStructuredOutput`). Make up for it with a tolerant parser and a `stopRegex` |
| Memory under 1.5 GB (2-bit or 4-bit weights, memory-mapped PLE) | Yes | No. About 2.5 GB `.pte` |
| Dynamic 128K context | Yes | Fixed `maxSeqLen` for each export. Check `getKVCacheState()` |
| Audio and vision input to Gemma | Yes | Vision is supported for some VLMs. **Audio is not supported yet** |

**Verdict:** yes, we can build Agent Skills with ExecuTorch. The two catches are that we write the Gemma 4 tool parser ourselves and that there is no constrained decoding. Moving to LiteRT-LM would mean writing our own native module (it has no official React Native binding), which isn't worth it for a hackathon.

### Skills for Hum (each one is a `ToolDefinition` with `execute`)
- `remember(fact)` / `recall(topic)`: long-term memory about the user, stored locally. Recall uses `useTextEmbeddings` for on-device semantic search.
- `log_mood(mood, note)` and `mood_trend(days)`: like the blog's sleep and mood demo. Hum speaks the trend aloud ("you've seemed lighter this week").
- `set_voice_style(warm|playful|calm)`: changes the Kokoro voice or speed in the middle of a conversation.
- `start_ritual(type)`: guided breathing, a goodnight wind-down, or a check-in routine.
- `end_call()`: lets the companion end the conversation gracefully.
- Limit each turn to `maxToolTurns: 2` and keep tool output short so speech latency stays low. Don't speak any tool-call text aloud: only `textContent` goes to TTS.

## Native Gemma audio through a custom `.pte` (Gemma hears the user directly)
**This is possible.** The library's *high-level* chat session blocks audio, but the lower-level APIs don't.

What I checked:
- The `.litertlm` files on Hugging Face (`google/gemma-3n-E2B-it-litert-lm`) only run on **LiteRT-LM**. ExecuTorch loads `.pte` files only, so it can't use them.
- Upstream ExecuTorch has an official Gemma 4 example, [`examples/models/gemma4`](https://github.com/pytorch/executorch/tree/main/examples/models/gemma4): "Supports audio transcription, translation, image understanding, and text generation on mobile devices." It is one `.pte` with these methods:
  - `speech_transform`: turns a waveform into a log-mel spectrogram (no learned weights, so no audio processing needed in JS)
  - `audio_encoder`: the USM Conformer, with inputs `(mel, mel_mask)`
  - `text_decoder`: the Gemma 4 decoder (YOCO, PLE)
  - Export flags: `--no-vision` gives audio and text only. The default context length is **1024 tokens** (`--max_seq_len`).
- **React Native ExecuTorch can run any `.pte` method.** `loadModel(path).execute('audio_encoder', inputs, outputs)` comes from `core/model.d.ts`, and `wrapAsync` keeps the work off the UI thread.
- The low-level `createLLMRunner(model, tok, ['audio'])` passes audio to ExecuTorch's generic `MultimodalRunner` (`cpp/extensions/llm/llm_runner.cpp:320`). The upstream Gemma 4 file **doesn't fit that runner**: it has no `token_embedding` method, its audio encoder takes two inputs, and it needs Gemma's own runner. So `createLLMRunner` won't work directly.

Measured on a Samsung S25 (from the upstream README), E2B, 23 s of audio:
| File | Size | Time to first token | Generation speed | Peak memory |
|---|---|---|---|---|
| `gemma4.pte` (4-bit, audio-only) | 4.1 GB | 4.5 s | 6 tok/s | 2.25 GB |
| `gemma4_tied_emb4.pte` | 2.5 GB | 4.5 s | 6 tok/s | 2.24 GB (needs TorchAO shared-embedding kernels, which may not be in RNE) |

A typical 3–5 s utterance should reach the first token in about 1 s. Generating at 6 tok/s is roughly speaking speed, so streaming sentences into TTS still works.

### How to build it (a spike before relying on it)
1. **Export** `gemma4.pte` with `--no-vision` (untied weights, so no extra kernels are needed) and a larger `--max_seq_len` (2048–4096). Or download the pre-exported file if Software Mansion or PyTorch host one. Host it ourselves and download it on first launch.
2. **Port `Gemma4Runner`** (`examples/models/gemma4/runner/gemma4_runner.cpp`, about 600 lines) into a **TypeScript worklet** built on `loadModel().execute()`:
   - 16 kHz Float32 PCM → `speech_transform` → `audio_encoder(mel, mask)` → audio embeddings
   - tokenize the chat template with the library's tokenizer API → `text_decoder` prefill with the audio embeddings in the audio-token slots
   - a decode loop: sample (temperature, top-p) → stream each token to the JS thread → stop at EOS
3. **Swap it in** behind the same `useBrain()` interface as the Whisper → Gemma path, so the rest of the voice loop doesn't change.
4. **What we gain:** no Whisper (saves about 100–220 MB and 100–300 ms), better handling of mixed languages like Hinglish, and Gemma can **hear tone, hesitation, and emotion**. That's a real advantage for an intimacy companion.
5. **Risks:**
   - The RNE native binary may be missing a custom op that `gemma4.pte` uses. Test this first with `loadModel` and `getModelSchema`.
   - Our tool calling and chat session would have to be rebuilt on top of the ported runner.
   - The 4.1 GB download.
   - Audio is limited to 30 s per turn. That's fine because VAD splits turns.

**Decision:** ship **Phase 1 (VAD → Whisper → Gemma 4 → Kokoro)** first, since it works today. In parallel, spend about 1 day on **Phase 2**: load `gemma4.pte` in RNE, run `speech_transform` and `audio_encoder` on a test WAV, and generate a few tokens. If that works, switch the brain to native audio.

## Recommended setup
| Stage | Choice | Why |
|---|---|---|
| Mic and playback | `react-native-audio-api` (voice-chat session with echo cancellation) | The docs recommend it, and echo cancellation lets the user interrupt the AI |
| Turn detection | `useVoiceActivityDetector` running on mic frames | Decides quickly when the user has finished talking (`minSilenceDurationMs` about 500–700) |
| STT | `WHISPER.EN.TINY` (`*_INT8` on CPU, `COREML_FP16` on iOS) | Fastest. Try BASE if accuracy is poor |
| LLM | `GEMMA4_E2B`: `MLX_INT4` on iOS, `XNNPACK_8DA4W` on Android | Fastest per platform. Use Vulkan only after benchmarking |
| TTS | Kokoro `EN_US`, voice picked from the persona (`af_heart` or `am_michael`) | Warmest and most natural voice |

## Voice loop (the core of the app)
1. **Listening.** Mic at 16 kHz → feed every frame to both `vad.detectVoiceOnStream` and `stt.streamInsert`. Show `nonCommitted` as a live "hearing you" orb animation (no text needed in the UI).
2. **End of turn.** On `speechEnd` plus the silence threshold → `stt.streamStop()` → take the `committed` text.
3. **Thinking.** `session.sendMessage(text, onToken)`. Use a short persona system prompt and `maxNewTokens` of about 120 so replies stay brief, spoken, and intimate. Tell the model to return **no markdown or emoji**.
4. **Speaking.** Split the token stream on sentence boundaries (`.!?…`). Send each finished sentence straight to Kokoro → `playStream`. The first audio plays as soon as the first sentence exists (low TTFA).
5. **Barge-in.** Keep VAD running while the AI speaks. On `speechStart`, stop the LLM, call `tts.synthesizeStop()` and `player.stop()`, and go back to step 1. Give the AI a very short "ducking" fade so the cut isn't abrupt.
6. **Tactile feel.** Use haptics on turn changes (`expo-haptics` is already installed) and a Skia orb that reacts to mic and output amplitude (`@shopify/react-native-skia` is already installed).

The state machine is `idle → listening → thinking → speaking → (barge-in) listening`. Only one model runs at a time on each stage, because the library returns `RESOURCE_BUSY` if one model is called concurrently.

## Gemma 4 E2B features worth using
- **Tool calling** (`toolOpts`): `remember_fact(key, value)`, `recall_facts()`, `set_mood(mood)`, `end_session()`. These give the companion local memory between conversations, stored in an on-device SQLite or MMKV store.
- **Multi-turn KV cache**: keeps a continuous conversation cheap. Watch `getKVCacheState().usageRatio`; at about 0.8, summarize older turns into the system prompt and reset.
- **Multilingual (140+ languages)**: Hindi or Hinglish can come later with multilingual Whisper and Kokoro HI.
- Vision input exists, but not for this app (voice-only).

## Privacy
- After the models download, nothing leaves the device. No analytics on transcripts. **Leave out Sentry, or scrub it**, so no message content is sent.
- Don't store any audio. Store transcripts and memories only if the user opts in, encrypted, with a "forget everything" button.
- The optional `privacyFilter` model can redact PII before anything is saved to memory.

## Files to create
- `docs/PLAN.md`: a copy of this plan, kept in the repo as requested.
- `src/voice/skills.ts`: the tool definitions above. `src/voice/gemmaToolParser.ts`: the Gemma 4 tool-call parser.
- `package.json`: set `react-native-executorch.features` to `["llm","speechToText","textToSpeech","vad"]`. The current `classification` and `styleTransfer` entries are unused. Then run `bunx expo install react-native-audio-api` and add its config plugin and mic permission strings in `app.json`.
- `src/voice/useVoiceLoop.ts`: the state machine above (VAD, STT, LLM, TTS, barge-in).
- `src/voice/useMic.ts` and `src/voice/usePlayer.ts`: wrappers around `react-native-audio-api` (16 kHz recorder, streaming player).
- `src/voice/sentenceChunker.ts`: turns the token stream into sentences.
- `src/voice/persona.ts`: male and female personas (system prompt and voice id).
- `src/app/index.tsx`: one-screen UI with the orb, a hold or tap-to-talk fallback, and model download progress.
- `src/app/onboarding.tsx`: pick a companion, download models (about 3 GB, Wi-Fi only), mic permission.

## Verification
- `bunx expo run:ios --device` / `run:android` on a real device with 8 GB of RAM (simulators are too slow for this).
- Measure **time from the end of speech to the first audio**. Target under 1.5 s. Log `turn.stats` and the timestamp of each stage.
- Barge-in test: start talking while the AI speaks. Audio should stop in under 200 ms and the AI shouldn't hear itself.
- Run a 20-turn conversation and check memory stays stable and that the KV-cache summarize step triggers.
- Before finishing, run `bunx expo lint` and `bunx tsc --noEmit`.
