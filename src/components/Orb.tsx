import { BlurMask, Canvas, Circle, RadialGradient, vec } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import {
  Easing,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { LoopState } from '@/voice/useVoiceLoop';

const PALETTE: Record<LoopState, [string, string, string]> = {
  off: ['#3A3350', '#221D33', '#0B0910'],
  starting: ['#8E7CFF', '#4B3BB8', '#0B0910'],
  listening: ['#FF9FC6', '#B04A86', '#0B0910'],
  thinking: ['#B9A8FF', '#5D47D6', '#0B0910'],
  speaking: ['#FFC9A3', '#E0607E', '#0B0910'],
};

type Props = {
  size: number;
  state: LoopState;
  micLevel: SharedValue<number>;
  outLevel: SharedValue<number>;
};

export function Orb({ size, state, micLevel, outLevel }: Props) {
  const c = size / 2;
  const base = size * 0.3;
  const breath = useSharedValue(0);
  const level = useSharedValue(0);

  useEffect(() => {
    const period = state === 'thinking' ? 700 : state === 'off' ? 3200 : 2000;
    breath.value = 0;
    breath.value = withRepeat(withTiming(1, { duration: period, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [breath, state]);

  useAnimatedReaction(
    () => (state === 'listening' ? micLevel.value : state === 'speaking' ? outLevel.value : 0),
    (target) => {
      level.value = withTiming(target, { duration: 140 });
    },
    [state],
  );

  const r = useDerivedValue(() => base * (1 + 0.06 * breath.value + 0.35 * level.value));
  const glowR = useDerivedValue(() => r.value * 1.35);
  const [inner, mid, outer] = PALETTE[state];

  return (
    <Canvas style={{ width: size, height: size }}>
      <Circle cx={c} cy={c} r={glowR} color={mid} opacity={0.35}>
        <BlurMask blur={size * 0.08} style="normal" />
      </Circle>
      <Circle cx={c} cy={c} r={r}>
        <RadialGradient c={vec(c * 0.85, c * 0.8)} r={base * 1.6} colors={[inner, mid, outer]} />
      </Circle>
    </Canvas>
  );
}
