import { useEffect, useState } from 'react';
import { AudioContext, type AudioBufferQueueSourceNode, type GainNode } from 'react-native-audio-api';
import { KOKORO_SAMPLE_RATE } from 'react-native-executorch';

const FADE_S = 0.08;

function createPlayer() {
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let source: AudioBufferQueueSourceNode | null = null;
  let pending = 0;
  let idleWaiters: (() => void)[] = [];
  let level = 0;

  const getCtx = () => {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: KOKORO_SAMPLE_RATE });
      gain = ctx.createGain();
      gain.connect(ctx.destination);
    }
    return { ctx, gain: gain! };
  };

  const notifyIdle = () => {
    if (pending > 0) return;
    level = 0;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((w) => w());
  };

  const player = {
    /** Rough output loudness (0..1) of the latest chunk, for the orb. */
    get level() {
      return pending > 0 ? level : 0;
    },
    get isPlaying() {
      return pending > 0;
    },

    enqueue(samples: Float32Array, sampleRate = KOKORO_SAMPLE_RATE) {
      if (samples.length === 0) return;
      const { ctx: c, gain: g } = getCtx();
      if (!source) {
        g.gain.cancelScheduledValues(c.currentTime);
        g.gain.setValueAtTime(1, c.currentTime);
        source = c.createBufferQueueSource();
        source.connect(g);
        source.onBufferEnded = () => {
          pending = Math.max(0, pending - 1);
          notifyIdle();
        };
        source.start();
      }
      const buffer = c.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(new Float32Array(samples), 0);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 32) sum += samples[i]! * samples[i]!;
      level = Math.min(1, Math.sqrt(sum / (samples.length / 32)) * 4);
      pending++;
      source.enqueueBuffer(buffer);
    },

    /** Resolves once everything queued so far has played. */
    waitUntilIdle(): Promise<void> {
      if (pending === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },

    /** Ends the current reply naturally (after it has drained). */
    release() {
      const s = source;
      source = null;
      if (!s) return;
      s.onBufferEnded = null;
      try {
        s.stop();
      } catch {}
      s.disconnect();
    },

    /** Barge-in: fade out fast and drop the queue. */
    interrupt() {
      const s = source;
      source = null;
      pending = 0;
      notifyIdle();
      if (!s || !ctx || !gain) return;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + FADE_S);
      s.onBufferEnded = null;
      try {
        s.stop(now + FADE_S);
      } catch {}
      setTimeout(
        () => {
          s.clearBuffers();
          s.disconnect();
        },
        FADE_S * 1000 + 50,
      );
    },

    async dispose() {
      player.interrupt();
      await ctx?.close();
      ctx = null;
      gain = null;
    },
  };
  return player;
}

export type Player = ReturnType<typeof createPlayer>;

/**
 * Streaming PCM player. Each spoken reply gets its own queue source so a
 * barge-in can drop everything already queued with one short fade.
 */
export function usePlayer(): Player {
  const [player] = useState(createPlayer);

  useEffect(() => () => void player.dispose(), [player]);

  return player;
}
