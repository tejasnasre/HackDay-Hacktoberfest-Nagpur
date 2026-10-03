import { Lucide } from '@react-native-vector-icons/lucide';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';
import { APPROX_DOWNLOAD_GB } from '@/voice/modelConfig';
import { PERSONAS, type PersonaId } from '@/voice/persona';
import { ensureMicPermission } from '@/voice/useMic';
import { useVoice } from '@/voice/VoiceProvider';

export default function Onboarding() {
  const { data, choosePersona, acceptModels, setRememberEnabled } = useVoice();
  const params = useLocalSearchParams<{ step?: string }>();
  const [step, setStep] = useState<'persona' | 'privacy'>(
    params.step === 'persona' || !data?.persona ? 'persona' : 'privacy',
  );
  const [micDenied, setMicDenied] = useState(false);

  const pick = async (id: PersonaId) => {
    void Haptics.selectionAsync();
    await choosePersona(id);
    setStep('privacy');
  };

  const begin = async () => {
    await acceptModels();
    const granted = await ensureMicPermission();
    if (!granted) {
      setMicDenied(true);
      return;
    }
    router.replace('/');
  };

  if (step === 'persona') {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.kicker}>Hum</Text>
          <Text style={styles.title}>Who would you like to talk to?</Text>
          <Text style={styles.body}>A voice companion for late nights, first dates and everything between.</Text>
          {(Object.keys(PERSONAS) as PersonaId[]).map((id) => (
            <Pressable
              key={id}
              onPress={() => pick(id)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              accessibilityRole="button">
              <View style={[styles.avatar, { backgroundColor: id === 'female' ? '#B04A86' : '#4B3BB8' }]}>
                <Text style={styles.avatarText}>{PERSONAS[id].name[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{PERSONAS[id].name}</Text>
                <Text style={styles.cardBody}>{PERSONAS[id].tagline}</Text>
              </View>
              <Lucide name="chevron-right" size={20} color={colors.textDim} />
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => setStep('persona')} hitSlop={12} style={styles.back}>
          <Lucide name="chevron-left" size={22} color={colors.textDim} />
        </Pressable>
        <Text style={styles.title}>Everything stays on your phone</Text>

        <Row
          icon="shield-check"
          text="Hum’s voice, ears and brain run fully on this device. Nothing you say is sent anywhere."
        />
        <Row icon="mic-off" text="Your voice is never recorded or saved." />
        <Row
          icon="download"
          text={`First, Hum downloads about ${APPROX_DOWNLOAD_GB} GB of AI models. Use Wi-Fi, and keep the app open.`}
        />

        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Remember me</Text>
            <Text style={styles.cardBody}>
              Let Hum keep small notes and moods between calls. You can erase them anytime.
            </Text>
          </View>
          <Switch
            value={data?.rememberEnabled ?? true}
            onValueChange={setRememberEnabled}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>

        {micDenied && (
          <Text style={styles.error}>Hum needs the microphone to hear you. Enable it in Settings, then try again.</Text>
        )}

        <Pressable onPress={begin} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}>
          <Text style={styles.ctaText}>Download and allow mic</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, text }: { icon: 'shield-check' | 'mic-off' | 'download'; text: string }) {
  return (
    <View style={styles.row}>
      <Lucide name={icon} size={20} color={colors.accent} />
      <Text style={[styles.body, { flex: 1, marginBottom: 0 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingTop: 48, gap: 14 },
  back: { marginBottom: 8, alignSelf: 'flex-start' },
  kicker: { color: colors.accent, fontSize: 15, fontWeight: '600', letterSpacing: 2, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 30, fontWeight: '700', lineHeight: 36, marginBottom: 4 },
  body: { color: colors.textDim, fontSize: 16, lineHeight: 23, marginBottom: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: { backgroundColor: colors.surfaceHi },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 2 },
  cardBody: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 4 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    borderRadius: 20,
    backgroundColor: colors.surface,
    marginTop: 8,
  },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  cta: {
    marginTop: 16,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 18,
    alignItems: 'center',
  },
  ctaText: { color: colors.accentInk, fontSize: 17, fontWeight: '700' },
});
