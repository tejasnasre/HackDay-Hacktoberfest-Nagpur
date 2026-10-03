import { Platform } from 'react-native';
import { models } from 'react-native-executorch';

// Gemma: MLX int4 on iOS devices (DEFAULT resolves to it, or XNNPACK on the
// simulator). On Android stay on XNNPACK until Vulkan is benchmarked on device.
export const LLM_MODEL =
  Platform.OS === 'android' ? models.llm.GEMMA4_E2B.XNNPACK_8DA4W : models.llm.GEMMA4_E2B.DEFAULT;

// Whisper tiny.en: Core ML fp16 on iOS, XNNPACK int8 on Android CPU.
export const STT_MODEL =
  Platform.OS === 'android'
    ? models.speechToText.WHISPER.EN.TINY.XNNPACK_INT8
    : models.speechToText.WHISPER.EN.TINY.DEFAULT;

export const TTS_MODEL = models.textToSpeech.KOKORO.EN_US.DEFAULT;

export const VAD_MODEL = models.voiceActivityDetection.FSMN_VAD.DEFAULT;

export const APPROX_DOWNLOAD_GB = 3.2;
