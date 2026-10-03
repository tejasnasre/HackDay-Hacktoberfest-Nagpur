import { useEffect, useState } from 'react';
import { AudioContext, type AudioBufferSourceNode, type GainNode } from 'react-native-audio-api';
import { KOKORO_SAMPLE_RATE } from 'react-native-executorch';

const FADE_S = 0.08;
// Small lead so the first chunk is never scheduled in the past.
const LEAD_S = 0.03;

type Scheduled = { node: AudioBufferSourceNode; start: number; end: number; level: number };

function createPlayer() {
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let scheduled: Scheduled[] = [];
  /** Audio-clock time at which everything queued so far has played. */
  let endsAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleWaiters: (() => void)[] = [];

  const getCtx = () => {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: KOKORO_SAMPLE_RATE });
      gain = ctx.createGain();
      gain.connect(ctx.destination);
    }
    return { ctx, gain: gain! };
  };

  const isPlaying = () => !!ctx && ctx.currentTime < endsAt;

  const notifyIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    scheduled = [];
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((w) => w());
  };

  /** Fires notifyIdle once the audio clock passes `endsAt`. */
  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    const remaining = ctx ? endsAt - ctx.currentTime : 0;
    idleTimer = setTimeout(
      () => {
        idleTimer = null;
        if (isPlaying()) armIdleTimer();
        else notifyIdle();
      },
      Math.max(0, remaining * 1000) + 20,
    );
  };

  const player = {
    /** Output loudness (0..1) of the chunk playing right now, for the waves. */
    get level() {
      if (!ctx) return 0;
      const now = ctx.currentTime;
      return scheduled.find((s) => now >= s.start && now < s.end)?.level ?? 0;
    },
    get isPlaying() {
      return isPlaying();
    },

    /**
     * Schedules a chunk right after the previous one, so sentences play
     * gaplessly even when synthesis runs ahead or behind playback.
     */
    enqueue(samples: Float32Array, sampleRate = KOKORO_SAMPLE_RATE) {
      if (samples.length === 0) return;
      const { ctx: c, gain: g } = getCtx();
      const now = c.currentTime;
      if (!isPlaying()) {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(1, now);
      }

      const buffer = c.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(new Float32Array(samples), 0);
      const node = c.createBufferSource();
      node.buffer = buffer;
      node.connect(g);

      const start = Math.max(now + LEAD_S, endsAt);
      const end = start + samples.length / sampleRate;
      node.start(start, 0);
      endsAt = end;

      let sum = 0;
      for (let i = 0; i < samples.length; i += 32) sum += samples[i]! * samples[i]!;
      const level = Math.min(1, Math.sqrt(sum / (samples.length / 32)) * 4);

      scheduled = scheduled.filter((s) => s.end > now);
      scheduled.push({ node, start, end, level });
      armIdleTimer();
    },

    /** Resolves once everything queued so far has played. */
    waitUntilIdle(): Promise<void> {
      if (!isPlaying()) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },

    /** Ends the current reply. Scheduled audio simply plays out. */
    release() {
      scheduled = scheduled.filter((s) => ctx && s.end > ctx.currentTime);
    },

    /** Barge-in: fade out fast and drop everything scheduled. */
    interrupt() {
      const nodes = scheduled.map((s) => s.node);
      const wasPlaying = isPlaying();
      endsAt = 0;
      notifyIdle();
      if (!ctx || !gain || nodes.length === 0) return;
      const now = ctx.currentTime;
      if (wasPlaying) {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + FADE_S);
      }
      for (const node of nodes) {
        try {
          node.stop(now + FADE_S);
        } catch {
          // Already stopped or not yet started.
        }
      }
      setTimeout(() => nodes.forEach((n) => n.disconnect()), FADE_S * 1000 + 50);
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
 * Streaming PCM player. Every chunk is its own buffer source, scheduled back
 * to back on the audio clock; "done" comes from that schedule, not from
 * native events, so a reply can never get stuck waiting.
 */
export function usePlayer(): Player {
  const [player] = useState(createPlayer);

  useEffect(() => () => void player.dispose(), [player]);

  return player;
}
