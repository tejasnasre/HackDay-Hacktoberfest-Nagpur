import { Lucide } from '@react-native-vector-icons/lucide';
import { Redirect, router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Orb } from '@/components/Orb';
import { colors } from '@/constants/colors';
import { PERSONAS } from '@/voice/persona';
import type { LoopState } from '@/voice/useVoiceLoop';
import { useVoice } from '@/voice/VoiceProvider';

const STATUS: Record<LoopState, (name: string) => string> = {
  off: (n) => `Tap to call ${n}`,
  starting: () => 'Connecting…',
  listening: () => 'Listening',
  thinking: () => 'Thinking',
  speaking: (n) => `${n} is talking · speak to interrupt`,
};

export default function Home() {
  const { data, loop } = useVoice();
  const { width } = useWindowDimensions();

  if (!data) return <View style={styles.screen} />;
  if (!data.persona || !data.modelsAccepted) return <Redirect href="/onboarding" />;

  const persona = PERSONAS[data.persona];
  const inCall = loop.state !== 'off';
  const orbSize = Math.min(width - 32, 360);

  const confirmForget = () =>
    Alert.alert('Forget everything?', `${persona.name} will forget every note and mood saved on this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: () => void loop.forget() },
    ]);

  const switchCompanion = () => {
    if (inCall) void loop.stop();
    router.push({ pathname: '/onboarding', params: { step: 'persona' } });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={switchCompanion} hitSlop={12} accessibilityLabel="Change companion">
          <Text style={styles.name}>{persona.name}</Text>
          <Text style={styles.sub}>on-device · private</Text>
        </Pressable>
        <Pressable onPress={confirmForget} hitSlop={12} accessibilityLabel="Forget everything">
          <Lucide name="trash-2" size={22} color={colors.textDim} />
        </Pressable>
      </View>

      <Pressable
        style={styles.orbWrap}
        onPress={inCall ? loop.tap : loop.start}
        disabled={!loop.isReady}
        accessibilityLabel={inCall ? 'Interrupt or finish speaking' : `Call ${persona.name}`}>
        <Orb size={orbSize} state={loop.state} micLevel={loop.micLevel} outLevel={loop.outLevel} />
      </Pressable>

      <View style={styles.footer}>
        {!loop.isReady ? (
          <Loading progress={loop.downloadProgress} error={loop.modelError?.message} />
        ) : (
          <>
            <Text style={styles.status}>{STATUS[loop.state](persona.name)}</Text>
            {loop.loopError && <Text style={styles.error}>{loop.loopError}</Text>}
            <Pressable
              onPress={inCall ? loop.stop : loop.start}
              style={({ pressed }) => [styles.callBtn, inCall && styles.hangUp, pressed && { opacity: 0.85 }]}
              accessibilityLabel={inCall ? 'End call' : 'Start call'}>
              <Lucide name={inCall ? 'phone-off' : 'phone'} size={28} color={inCall ? colors.text : colors.accentInk} />
            </Pressable>
            {__DEV__ && loop.lastStats && (
              <Text style={styles.stats}>
                first token {loop.lastStats.firstTokenMs} ms · first audio {loop.lastStats.firstAudioMs} ms
              </Text>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function Loading({ progress, error }: { progress: number; error?: string }) {
  if (error) return <Text style={styles.error}>Couldn’t load Hum’s models: {error}</Text>;
  const downloading = progress < 100;
  return (
    <View style={{ width: '100%', alignItems: 'center', gap: 12 }}>
      <Text style={styles.status}>
        {downloading ? `Downloading voice models · ${Math.floor(progress)}%` : 'Waking up…'}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(2, progress)}%` }]} />
      </View>
      {downloading && <Text style={styles.sub}>About 3 GB, one time only. Keep Hum open on Wi-Fi.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  name: { color: colors.text, fontSize: 24, fontWeight: '700' },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 2, textAlign: 'center' },
  orbWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 32, gap: 18, minHeight: 170 },
  status: { color: colors.text, fontSize: 17, fontWeight: '500', textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  callBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangUp: { backgroundColor: '#E5484D' },
  stats: { color: colors.textDim, fontSize: 12 },
  track: { width: '100%', height: 6, borderRadius: 3, backgroundColor: colors.surfaceHi, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
});
