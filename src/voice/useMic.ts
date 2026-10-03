import { useEffect, useState } from 'react';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';

export const MIC_SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 1600; // 100 ms

let sessionConfigured = false;

/**
 * Voice-chat audio session: on iOS the `voiceChat` mode turns on the system
 * echo canceller, which is what lets the user interrupt Hum while it talks.
 */
export async function configureVoiceSession() {
  if (sessionConfigured) return;
  AudioManager.setAudioSessionOptions({
    iosCategory: 'playAndRecord',
    iosMode: 'voiceChat',
    iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
  });
  await AudioManager.setAudioSessionActivity(true);
  sessionConfigured = true;
}

export async function ensureMicPermission(): Promise<boolean> {
  const status = await AudioManager.checkRecordingPermissions();
  if (status === 'Granted') return true;
  return (await AudioManager.requestRecordingPermissions()) === 'Granted';
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0]! + (input[i1]! - input[i0]!) * (x - i0);
  }
  return out;
}

export type MicFrameHandler = (frame: Float32Array, rms: number) => void;

function createMic(initial: MicFrameHandler) {
  let recorder: AudioRecorder | null = null;
  let handler = initial;
  return {
    setHandler(h: MicFrameHandler) {
      handler = h;
    },
    get active() {
      return recorder !== null;
    },
    async start() {
      if (recorder) return;
      await configureVoiceSession();
      const r = new AudioRecorder();
      const ready = r.onAudioReady(
        { sampleRate: MIC_SAMPLE_RATE, bufferLength: FRAME_SAMPLES, channelCount: 1 },
        ({ buffer }) => {
          const frame = resample(new Float32Array(buffer.getChannelData(0)), buffer.sampleRate, MIC_SAMPLE_RATE);
          let sum = 0;
          for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
          handler(frame, Math.sqrt(sum / Math.max(1, frame.length)));
        },
      );
      if (ready.status !== 'success') throw new Error(`Mic setup failed: ${ready.message}`);
      const started = await r.start();
      if (started.status !== 'success') throw new Error(`Mic start failed: ${started.message}`);
      recorder = r;
    },
    async stop() {
      const r = recorder;
      recorder = null;
      if (!r) return;
      r.clearOnAudioReady();
      await r.stop();
    },
  };
}

/** 16 kHz mono mic stream. Frames are delivered on the JS thread. */
export function useMic(onFrame: MicFrameHandler) {
  const [mic] = useState(() => createMic(onFrame));

  useEffect(() => {
    mic.setHandler(onFrame);
  }, [mic, onFrame]);

  useEffect(() => () => void mic.stop(), [mic]);

  return mic;
}
