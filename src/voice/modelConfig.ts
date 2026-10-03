import { Platform } from 'react-native';
import { models, type KokoroTtsModel } from 'react-native-executorch';

import type { KokoroVoice, Language } from './persona';

// Gemma: MLX int4 on iOS devices (DEFAULT resolves to it, or XNNPACK on the
// simulator). On Android stay on XNNPACK until Vulkan is benchmarked on device.
export const LLM_MODEL =
  Platform.OS === 'android' ? models.llm.GEMMA4_E2B.XNNPACK_8DA4W : models.llm.GEMMA4_E2B.DEFAULT;

// English: Whisper tiny.en, Core ML fp16 on iOS, XNNPACK int8 on Android CPU.
// Hindi needs a multilingual Whisper; tiny is too inaccurate for it, so base.
export const STT_MODELS = {
  en:
    Platform.OS === 'android'
      ? models.speechToText.WHISPER.EN.TINY.XNNPACK_INT8
      : models.speechToText.WHISPER.EN.TINY.DEFAULT,
  hi: Platform.OS === 'android' ? models.speechToText.WHISPER.BASE.XNNPACK_FP32 : models.speechToText.WHISPER.BASE.DEFAULT,
} satisfies Record<Language, unknown>;

// Typed over every persona voice; each persona only asks for voices its language pack has.
export const TTS_MODELS: Record<Language, KokoroTtsModel<KokoroVoice>> = {
  en: models.textToSpeech.KOKORO.EN_US.DEFAULT as KokoroTtsModel<KokoroVoice>,
  hi: models.textToSpeech.KOKORO.HI.DEFAULT as KokoroTtsModel<KokoroVoice>,
};

export const VAD_MODEL = models.voiceActivityDetection.FSMN_VAD.DEFAULT;

export const APPROX_DOWNLOAD_GB = 3.2;
/** Voice models only (Whisper, Kokoro, VAD), when Gemini is the brain. */
export const APPROX_VOICE_DOWNLOAD_GB = 0.5;
