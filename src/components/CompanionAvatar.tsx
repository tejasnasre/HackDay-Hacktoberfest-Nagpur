import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { GradientAvatar } from '@/shared/components/gradient-avatar';
import { PERSONAS, type PersonaId } from '@/voice/persona';

type Props = {
  persona: PersonaId;
  size: number;
  /** Drawn centred on top of the gradient, e.g. an icon. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** The companion's face: a mesh gradient in their own colours. */
export function CompanionAvatar({ persona, size, children, style }: Props) {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <GradientAvatar token={persona} size={size} palette={PERSONAS[persona].palette} />
      {children && <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
