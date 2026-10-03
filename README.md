<div align="center">

<h1>🎙️ Hum</h1>

<img src="./assets/images/icon.png" width="120" height="120" alt="Hum logo" style="border-radius: 26px;" />

<p><strong>An on-device AI voice companion — private by design, intimate by nature.</strong></p>

<p>
  <img alt="Expo SDK" src="https://img.shields.io/badge/Expo-SDK%2057-000020?logo=expo&logoColor=white">
  <img alt="React Native" src="https://img.shields.io/badge/React%20Native-0.86-61DAFB?logo=react&logoColor=black">
  <img alt="Platform" src="https://img.shields.io/badge/Platform-iOS%2017%2B%20%7C%20Android%2013%2B-lightgrey">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-pink">
  <img alt="Hacktoberfest" src="https://img.shields.io/badge/Hacktoberfest-Nagpur%202026-FF6D00">
</p>

<p><em>Everything — speech recognition, language model, text-to-speech — runs fully on your phone.<br>Not one word you say is ever sent to a server.</em></p>

</div>

---

## ✨ What is Hum?

Hum is a **voice-only AI companion** for people who want someone to talk to — about relationships, late nights, loneliness, first dates, or just how their day went. You pick a persona, tap to connect, and have a real conversation.

The entire AI pipeline runs locally using **ExecuTorch** and **Expo SDK 57**. After the initial ~3 GB model download over Wi-Fi, the app works fully offline. No analytics. No transcripts sent anywhere. No servers.

| Persona | Voice | Personality |
|---------|-------|-------------|
| 🌸 **Mira** | `af_heart` (warm) · `af_sarah` (playful) · `af_river` (calm) | Soft-spoken, teasing, always curious about you |
| 🌊 **Kai** | `am_michael` (warm/calm) · `am_adam` (playful) | Steady, warm, a good listener with a dry wit |

---

## 🏗️ Architecture

### Voice Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                        Microphone                           │
│                   react-native-audio-api                    │
│                    16 kHz · mono · PCM                      │
└────────────────────────┬────────────────────────────────────┘
                         │ Float32 frames (100 ms)
              ┌──────────┴──────────┐
              ▼                     ▼
   ┌─────────────────┐   ┌──────────────────────┐
   │  VAD (FSMN-VAD) │   │  STT (Whisper tiny.en)│
   │   1.8 MB · 2 ms │   │  60–220 MB · on-device│
   │  speechStart /  │   │  stream / streamInsert│
   │  speechEnd      │   │  committed text       │
   └────────┬────────┘   └──────────┬────────────┘
            │ barge-in              │ user turn text
            │              ┌────────┘
            │              ▼
            │   ┌──────────────────────────────┐
            │   │     LLM — Gemma 4 E2B        │
            │   │  iOS: MLX int4  (~2.5 GB)    │
            │   │  Android: XNNPACK 8da4w      │
            │   │  tool calls · KV cache       │
            │   │  max 120 tokens / reply      │
            │   └──────────┬───────────────────┘
            │              │ token stream
            │              ▼
            │   ┌──────────────────────────────┐
            │   │    TTS — Kokoro EN_US        │
            │   │   ~332 MB · 24 kHz PCM       │
            │   │  sentence-streaming chunks   │
            │   └──────────┬───────────────────┘
            │              │ PCM audio chunks
            │              ▼
            │   ┌──────────────────────────────┐
            └──►│     Player (AudioContext)    │
                │  80 ms fade-out on barge-in  │
                └──────────────────────────────┘
```

### State Machine

```
  off ──[tap]──► starting ──► speaking (greeting)
                                    │
                            ◄───────┘
  ┌─────────────────────────┐
  │  listening              │◄──────── barge-in (VAD speechStart)
  │  (Whisper + VAD)        │
  └────────┬────────────────┘
           │ committed text
           ▼
  ┌─────────────────────────┐
  │  thinking               │
  │  (Gemma 4 streaming)    │
  └────────┬────────────────┘
           │ first sentence ready
           ▼
  ┌─────────────────────────┐
  │  speaking               │──[end]──► off
  │  (Kokoro + Player)      │
  └─────────────────────────┘
```

---

## 🤖 AI Models

| Role | Model | Size | Speed |
|------|-------|------|-------|
| **LLM** | Gemma 4 E2B — `MLX_INT4` (iOS) · `XNNPACK_8DA4W` (Android) | ~2.5 GB | 6 tok/s |
| **STT** | Whisper tiny.en — `COREML_FP16` (iOS) · `XNNPACK_INT8` (Android) | 60–220 MB | ~100–300 ms |
| **TTS** | Kokoro EN_US | ~332 MB | Streaming per sentence |
| **VAD** | FSMN-VAD | 1.8 MB | 2–5 ms per frame |

> **Target device:** iPhone 15 Pro / Pixel 8 or later (~8 GB RAM). Total weights ≈ 3.2 GB in RAM.

---

## 🧠 Companion Skills (Tool Calling)

Gemma 4 E2B supports function calling. Hum uses this to give the companion persistent memory and adaptive behaviour — all stored on-device:

| Skill | What it does |
|-------|-------------|
| `remember(key, value)` | Saves a lasting fact the user shares (name, job, relationship) |
| `recall(topic)` | Looks up relevant memories with keyword matching |
| `log_mood(mood, intensity, note)` | Records how the user is feeling right now |
| `mood_trend(days)` | Summarises emotional trends over the last N days |
| `set_voice_style(warm \| playful \| calm)` | Changes Kokoro voice mid-conversation |
| `start_ritual(breathing \| goodnight \| checkin)` | Guided breathing, wind-down, or check-in ritual |
| `end_call()` | Lets the companion gracefully close the conversation |

> Tool calls are silently parsed from Gemma's `<|tool_call>…<tool_call|>` syntax and never spoken aloud. Only `textContent` reaches TTS.

---

## 🔒 Privacy

- After the one-time model download, **zero network requests are made**.
- Voice is **never recorded or stored**. Audio frames are processed in memory only.
- Facts and moods are stored in an **AES-256 encrypted MMKV store**. The encryption key lives in the iOS Keychain / Android Keystore — never on disk.
- Users can **"Forget everything"** at any time, which wipes all facts and moods instantly.
- Memory features are **opt-in** and can be disabled on the onboarding screen.

---

## 📂 Project Layout

```
hum/
├── app.json                  # Expo config (plugins, permissions, EAS project)
├── package.json              # Dependencies + react-native-executorch features
├── eas.json                  # EAS build profiles (development / preview / production)
├── docs/
│   └── PLAN.md               # Full architecture plan, feasibility notes, roadmap
└── src/
    ├── app/
    │   ├── _layout.tsx       # Root navigator: Stack + VoiceProvider + GestureHandler
    │   ├── index.tsx         # Main screen: Skia orb, call/hang-up, status, dev stats
    │   └── onboarding.tsx    # Step 1: persona picker  Step 2: privacy + model consent
    ├── components/
    │   └── Orb.tsx           # Skia canvas orb — colour & radius react to mic/out level
    ├── constants/
    │   └── colors.ts         # Design tokens (dark palette: #0B0910 bg, #FF8FB8 accent)
    └── voice/
        ├── VoiceProvider.tsx     # Context: exposes loop controls + persistent data
        ├── useVoiceLoop.ts       # Full voice state machine with barge-in, preroll
        ├── useBrain.ts           # Gemma 4 session: build, reset, compact, stop
        ├── useMic.ts             # AudioRecorder at 16 kHz with voiceChat session
        ├── usePlayer.ts          # Streaming AudioBufferQueueSourceNode with fade-out
        ├── sentenceChunker.ts    # Splits token stream into sentences for low-latency TTS
        ├── gemmaToolParser.ts    # Parses Gemma 4 tool-call format; strips control tokens
        ├── skills.ts             # HUM_SKILLS: all ToolDefinition objects + callSignals
        ├── memoryStore.ts        # MMKV store: facts, moods, prefs — AES-256 encrypted
        ├── modelConfig.ts        # Platform-aware model URL constants
        └── persona.ts            # Mira/Kai definitions + buildSystemPrompt()
```

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js ≥ 18 | Or Bun ≥ 1.x (`bun.lock` committed) |
| Expo account | For EAS builds — free at [expo.dev](https://expo.dev) |
| **Real iOS device** (iPhone 15 Pro+) or **Android device** (Pixel 8+) | Simulators/emulators are too slow for 3 GB models |
| iOS 17+ · Android 13+ | Minimum OS versions |

> ⚠️ **Expo Go is not supported.** The app uses compiled native modules (`react-native-executorch`, `react-native-audio-api`). A development build is required.

---

### 1. Install dependencies

```bash
# Preferred — bun.lock is committed
bun install

# Or npm (note the flag: react-native-blob-util is pinned to ^0.24.0 for executorch compat)
npm install --legacy-peer-deps
```

### 2. Diagnose dependency issues

```bash
npx expo-doctor
npx expo install --fix   # resolves any SDK-incompatible package versions
```

### 3. Create a development build

The first time (or after adding any native package), you need to (re-)build the native binary.

**Option A — EAS Cloud (no Xcode / Android Studio needed):**

```bash
# iOS
npx eas-cli build --platform ios --profile development

# Android
npx eas-cli build --platform android --profile development
```

Install the resulting `.ipa` / `.apk` on your device, then proceed to step 4.

**Option B — Local build (requires Xcode 15+ or Android Studio):**

```bash
npx expo run:ios      # builds + installs on a connected iOS device
npx expo run:android  # builds + installs on a connected Android device
```

### 4. Start the dev server

```bash
npx expo start
```

Scan the QR code with the **Expo Dev Client** app (not Expo Go) installed on your device.

---

## 🧪 Verification

Before submitting a PR, run:

```bash
npx expo lint        # ESLint
npx tsc --noEmit     # TypeScript strict check
```

On a real device, verify:

- [ ] **Time-to-first-audio** (end of speech → first TTS audio) < 1.5 s
- [ ] **Barge-in** — speak while Hum talks; audio stops in < 200 ms
- [ ] **20-turn conversation** — RAM stable, KV-cache compaction triggers at ~80 %
- [ ] **Forget everything** — wipes facts + moods, session resets cleanly
- [ ] **Persona switch** — changing persona resets the LLM session correctly
- [ ] **Offline after download** — disable Wi-Fi, conversation still works

---

## 🛠️ Key Implementation Notes

### Barge-in
VAD (`FSMN-VAD`) runs on every mic frame even while Hum is speaking. On `speechStart`, the LLM generation is stopped, `synthesizeStop()` is called, and the audio player fades to silence in 80 ms. An 800 ms preroll buffer preserves the user's first words so nothing is missed.

### KV-Cache management
Gemma 4 E2B has a fixed `maxSeqLen` per export. When `getKVCacheState().usageRatio` crosses 0.8, `useBrain.compact()` rebuilds the session keeping the last 6 spoken turns + the system prompt — allowing indefinitely long conversations.

### Sentence-streaming TTS
`sentenceChunker.ts` splits the token stream at `.!?…` boundaries (with abbreviation awareness and a 140-char clause flush) and pipes each finished sentence into Kokoro immediately — cutting time-to-first-audio dramatically compared to waiting for the full reply.

### Tool-call parsing
Gemma 4 emits tool calls in a custom token format:
```
<|tool_call>call:log_mood{mood:<|"|>sad<|"|>,intensity:3}<tool_call|>
```
`gemmaToolParser.ts` handles bare keys, `<|"|>` string tokens, nested objects, and arrays. `TOOL_CALL_STOP_REGEX` halts generation the moment a call closes so the session can execute the tool before resuming.

### Encrypted memory
`memoryStore.ts` uses MMKV encrypted with AES-256. The encryption key is 16 random bytes (stored as 32 hex chars) generated on first launch and saved in the iOS Keychain / Android Keystore via `expo-secure-store`. The key never touches disk.

---

## 🗺️ Roadmap

- **Phase 1 (done)** — VAD → Whisper → Gemma 4 → Kokoro full pipeline
- **Phase 2 (spike)** — Native audio input via `gemma4.pte` (`speech_transform` + `audio_encoder`) — eliminates Whisper, adds emotion/tone awareness, supports Hinglish
- **Future** — Multilingual Whisper + Kokoro HI for Hindi/Hinglish; `useTextEmbeddings` for semantic recall

---

## 📋 EAS Project

| Field | Value |
|-------|-------|
| Project ID | `afa95fc7-ae29-49dd-bdb0-6425c6487907` |
| Owner | `tejasnasre` |
| Bundle ID | `com.tejasnasre.Hum` |
| iOS deployment target | 17.0 |
| EAS profiles | `development` · `preview` · `production` |

---

## 📄 License

MIT © 2026 Tejas Nasre & Hackday Hacktoberfest Nagpur contributors


