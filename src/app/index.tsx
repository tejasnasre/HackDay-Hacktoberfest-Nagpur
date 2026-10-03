import { Lucide } from '@react-native-vector-icons/lucide';
import { Redirect, router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CompanionAvatar } from '@/components/CompanionAvatar';
import { Orb } from '@/components/Orb';
import { CircularStatusBarIphoneDuo } from '@/shared/components/circular-status-bar-iphone-duo';
import { GradientAvatar } from '@/shared/components/gradient-avatar';
import { colors } from '@/constants/colors';
import { APPROX_DOWNLOAD_GB, APPROX_VOICE_DOWNLOAD_GB } from '@/voice/modelConfig';
import { PERSONAS } from '@/voice/persona';
import { VOICE_BARGE_IN, type LoopState } from '@/voice/useVoiceLoop';
import { useVoice } from '@/voice/VoiceProvider';

const CALL_SIZE = 76;
// The end-call button's gradient: the only red in the app.
const END_CALL_REDS = ['#FF3B30', '#B3001B', '#FF6A55', '#7A0010'];
// The waking-up animation is 600x380, with its ring centred; the icon sits inside the ring.
const WAKE_WIDTH = 150;
const WAKE_HEIGHT = (WAKE_WIDTH * 380) / 600;

const STATUS: Record<LoopState, { title: (name: string) => string; hint: string }> = {
  off: { title: (n) => `Call ${n}`, hint: 'Tap the waves or the button to start' },
  starting: { title: () => 'Connecting…', hint: 'One moment' },
  listening: { title: () => 'Listening', hint: 'Just talk, pause when you’re done' },
  thinking: { title: () => 'Thinking', hint: 'Tap to interrupt' },
  speaking: {
    title: (n) => `${n} is talking`,
    hint: VOICE_BARGE_IN ? 'Speak anytime to interrupt' : 'Tap the waves to interrupt',
  },
};

export default function Home() {
  const { data, loop, geminiAvailable } = useVoice();
  const { width } = useWindowDimensions();

  if (!data) return <View style={styles.screen} />;
  if (!data.persona || !data.modelsAccepted) return <Redirect href="/onboarding" />;

  const persona = PERSONAS[data.persona];
  const inCall = loop.state !== 'off';
  // Wider than the screen: the strands fade out well before the canvas edges.
  const orbSize = width * 1.45;
  const gemini = data.engine === 'gemini';
  const needsKey = gemini && !geminiAvailable;
  const status = STATUS[loop.state];

  const confirmForget = () =>
    Alert.alert('Forget everything?', `${persona.name} will forget every note and mood saved on this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: () => void loop.forget() },
    ]);

  const openSettings = () => {
    if (inCall) void loop.stop();
    router.push('/settings');
  };

  const switchCompanion = () => {
    if (inCall) void loop.stop();
    router.push({ pathname: '/onboarding', params: { step: 'persona' } });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={switchCompanion}
          hitSlop={8}
          style={styles.who}
          accessibilityLabel={`Change companion, now ${persona.name}`}>
          <CompanionAvatar persona={data.persona} size={44} />
          <View>
            <Text style={styles.name}>{persona.name}</Text>
            <View style={styles.pill}>
              <Lucide name={gemini ? 'cloud' : 'shield-check'} size={12} color={colors.accent} />
              <Text style={styles.pillText}>{gemini ? 'Gemini · your key' : 'On-device · private'}</Text>
            </View>
          </View>
        </Pressable>
        <View style={styles.headerActions}>
          <IconButton icon="settings" label="Settings" onPress={openSettings} />
          <IconButton icon="trash-2" label="Forget everything" onPress={confirmForget} />
        </View>
      </View>

      <Pressable
        style={styles.orbWrap}
        onPress={inCall ? loop.tap : loop.start}
        disabled={!loop.isReady}
        accessibilityLabel={inCall ? 'Interrupt or finish speaking' : `Call ${persona.name}`}>
        <Orb size={orbSize} palette={persona.palette} state={loop.state} micLevel={loop.micLevel} outLevel={loop.outLevel} />
      </Pressable>

      <View style={styles.footer}>
        {needsKey ? (
          <>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Text style={styles.status}>Add your Gemini key</Text>
              <Text style={styles.hint}>Or switch back to on-device in settings</Text>
            </View>
            <Pressable onPress={openSettings} style={({ pressed }) => [styles.keyBtn, pressed && styles.pressed]}>
              <Lucide name="key-round" size={18} color={colors.accentInk} />
              <Text style={styles.keyBtnText}>Add key</Text>
            </Pressable>
          </>
        ) : !loop.isReady ? (
          <Loading progress={loop.downloadProgress} error={loop.modelError?.message} gemini={gemini} />
        ) : (
          <>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Text style={styles.status}>{status.title(persona.name)}</Text>
              <Text style={styles.hint}>{status.hint}</Text>
            </View>
            {loop.loopError && <Text style={styles.error}>{loop.loopError}</Text>}
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={inCall ? loop.stop : loop.start}
                style={({ pressed }) => pressed && styles.pressed}
                accessibilityLabel={inCall ? 'End call' : 'Start call'}>
                {inCall ? (
                  <View style={styles.hangUp}>
                    <GradientAvatar token="end-call" size={CALL_SIZE} palette={END_CALL_REDS} />
                    <View style={[StyleSheet.absoluteFill, styles.center]}>
                      <Lucide name="phone-off" size={28} color="#FFFFFF" />
                    </View>
                  </View>
                ) : (
                  <CompanionAvatar persona={data.persona} size={CALL_SIZE}>
                    <Lucide name="phone" size={28} color="#FFFFFF" />
                  </CompanionAvatar>
                )}
              </Pressable>
              <Text style={styles.callLabel}>{inCall ? 'End' : 'Call'}</Text>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function IconButton({ icon, label, onPress }: { icon: 'settings' | 'trash-2'; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: colors.surfaceHi }]}>
      <Lucide name={icon} size={20} color={colors.textDim} />
    </Pressable>
  );
}

function Loading({ progress, error, gemini }: { progress: number; error?: string; gemini: boolean }) {
  if (error) {
    return (
      <View style={styles.card}>
        <Lucide name="triangle-alert" size={20} color={colors.danger} />
        <Text style={[styles.error, { flex: 1, textAlign: 'left' }]}>Couldn’t load Hum’s models: {error}</Text>
      </View>
    );
  }
  const downloading = progress < 100;
  if (!downloading) {
    return (
      <View style={[styles.card, { flexDirection: 'column', gap: 4 }]}>
        <View style={{ width: WAKE_WIDTH, height: WAKE_HEIGHT }}>
          <CircularStatusBarIphoneDuo size={WAKE_WIDTH} color={colors.accent} showWifi={false} accessibilityLabel="Waking up" />
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
            <Lucide name="sparkles" size={22} color={colors.accent} />
          </View>
        </View>
        <Text style={styles.cardTitle}>Waking up…</Text>
      </View>
    );
  }
  return (
    <View style={[styles.card, { flexDirection: 'column', alignItems: 'stretch', gap: 12 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.cardTitle}>Downloading voice models</Text>
        <Text style={styles.percent}>{Math.floor(progress)}%</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(2, progress)}%` }]} />
      </View>
      <Text style={styles.hint}>
        About {gemini ? APPROX_VOICE_DOWNLOAD_GB : APPROX_DOWNLOAD_GB} GB, one time only. Keep Hum open on Wi-Fi.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: colors.text, fontSize: 22, fontWeight: '700' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  pillText: { color: colors.textDim, fontSize: 13 },
  headerActions: { flexDirection: 'row', gap: 10 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  orbWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 28, gap: 20, minHeight: 200 },
  status: { color: colors.text, fontSize: 22, fontWeight: '600', textAlign: 'center' },
  hint: { color: colors.textDim, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  hangUp: { width: CALL_SIZE, height: CALL_SIZE },
  center: { alignItems: 'center', justifyContent: 'center' },
  callLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  keyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 16,
  },
  keyBtnText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
  card: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  percent: { color: colors.accent, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { width: '100%', height: 6, borderRadius: 3, backgroundColor: colors.surfaceHi, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
});
