import { useState } from 'react';
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SiriIOS27 } from '@/shared/components/siri-ios-27';
import type { LoopState } from '@/voice/useVoiceLoop';

type Look = {
  /** Strand colors for the Siri waves; 'palette' means the companion's own colours. */
  colors: readonly string[] | 'palette';
  /** Resting wave energy, and how much voice loudness adds on top. */
  rest: number;
  gain: number;
  speed: number;
  strandCount: number;
};

const LOOKS: Record<LoopState, Look> = {
  // Greys and white while idle or when the user talks; colour only when the companion speaks.
  off: { colors: ['#5A5A5A', '#333333', '#7A7A7A'], rest: 0.05, gain: 0, speed: 0.35, strandCount: 3 },
  starting: { colors: ['#FFFFFF', '#9A9A9A', '#CFCFCF'], rest: 0.3, gain: 0, speed: 1, strandCount: 4 },
  listening: { colors: ['#FFFFFF', '#D9D9D9', '#A6A6A6', '#F2F2F2'], rest: 0.15, gain: 0.85, speed: 1.1, strandCount: 5 },
  thinking: { colors: ['#E6E6E6', '#8C8C8C', '#BFBFBF', '#FFFFFF'], rest: 0.4, gain: 0, speed: 2.2, strandCount: 4 },
  speaking: {
    colors: 'palette',
    rest: 0.2,
    gain: 0.8,
    speed: 1.3,
    strandCount: 6,
  },
};

// Loudness is snapped to this step, so tiny changes do not re-render.
const LEVEL_STEP = 0.05;

// Taller, thicker strands than the component's defaults: the orb is the whole screen.
const AMPLITUDE = 1.7;
const THICKNESS = 1.3;

type Props = {
  size: number;
  /** The companion's colours, used while they speak. */
  palette: readonly string[];
  state: LoopState;
  micLevel: SharedValue<number>;
  outLevel: SharedValue<number>;
};

/** Hum's face: Siri-style voice strands that follow whoever is talking. */
export function Orb({ size, palette, state, micLevel, outLevel }: Props) {
  const look = LOOKS[state];
  const [voice, setVoice] = useState(0);

  // SiriIOS27 takes a plain number, so bring loudness over from the UI thread,
  // only when the snapped value changes.
  useAnimatedReaction(
    () => {
      const raw = state === 'listening' ? micLevel.value : state === 'speaking' ? outLevel.value : 0;
      return Math.round(raw / LEVEL_STEP) * LEVEL_STEP;
    },
    (now, prev) => {
      if (now !== prev) scheduleOnRN(setVoice, now);
    },
    [state],
  );

  const level = Math.min(1, look.rest + look.gain * voice);

  return (
    <SiriIOS27
      width={size}
      height={size}
      level={level}
      colors={look.colors === 'palette' ? palette : look.colors}
      speed={look.speed}
      amplitude={AMPLITUDE}
      thickness={THICKNESS}
      strandCount={look.strandCount}
    />
  );
}
