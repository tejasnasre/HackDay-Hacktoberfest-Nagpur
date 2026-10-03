import { Lucide } from '@react-native-vector-icons/lucide';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/colors';
import { BUILT_IN_GEMINI_KEY } from '@/voice/geminiKey';
import type { BrainEngine } from '@/voice/memoryStore';
import { APPROX_DOWNLOAD_GB, APPROX_VOICE_DOWNLOAD_GB } from '@/voice/modelConfig';
import { useVoice } from '@/voice/VoiceProvider';

const KEY_URL = 'https://aistudio.google.com/apikey';

const OPTIONS: { id: BrainEngine; icon: 'smartphone' | 'cloud'; title: string; body: string }[] = [
  {
    id: 'device',
    icon: 'smartphone',
    title: 'On this phone',
    body: `Fully private and works offline. Downloads about ${APPROX_DOWNLOAD_GB} GB.`,
  },
  {
    id: 'gemini',
    icon: 'cloud',
    title: 'Gemini, with your API key',
    body: `Smarter and lighter (about ${APPROX_VOICE_DOWNLOAD_GB} GB). What you say is sent to Google as text.`,
  },
];

/** Lets the user choose where Hum's brain runs and add their own Gemini key. */
export function BrainPicker() {
  const { data, geminiKey, setEngine, setGeminiKey } = useVoice();
  const engine = data?.engine ?? 'device';
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  const pick = (id: BrainEngine) => {
    void Haptics.selectionAsync();
    void setEngine(id);
  };

  const save = async () => {
    if (!draft.trim()) return;
    await setGeminiKey(draft);
    setDraft('');
    setEditing(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const showInput = editing || !geminiKey;

  return (
    <View style={{ gap: 12 }}>
      {OPTIONS.map((o) => {
        const selected = engine === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => pick(o.id)}
            style={[styles.card, selected && styles.cardSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}>
            <Lucide name={o.icon} size={22} color={selected ? colors.accent : colors.textDim} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{o.title}</Text>
              <Text style={styles.body}>{o.body}</Text>
            </View>
            <Lucide name={selected ? 'circle-check' : 'circle'} size={22} color={selected ? colors.accent : colors.border} />
          </Pressable>
        );
      })}

      {engine === 'gemini' && (
        <View style={styles.keyBox}>
          {showInput ? (
            <>
              <Text style={styles.body}>
                {BUILT_IN_GEMINI_KEY
                  ? 'Hum has a shared key built in. Add your own to use your quota instead.'
                  : 'Paste your Gemini API key. It is stored in this phone’s secure keychain.'}
              </Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="AIza…"
                placeholderTextColor={colors.textDim}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={save}
                style={styles.input}
                accessibilityLabel="Gemini API key"
              />
              <View style={styles.actions}>
                <Pressable onPress={() => WebBrowser.openBrowserAsync(KEY_URL)} hitSlop={8} style={styles.link}>
                  <Lucide name="external-link" size={16} color={colors.accent} />
                  <Text style={styles.linkText}>Get a free key</Text>
                </Pressable>
                <Pressable
                  onPress={save}
                  disabled={!draft.trim()}
                  style={[styles.save, !draft.trim() && { opacity: 0.4 }]}>
                  <Text style={styles.saveText}>Save key</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.actions}>
              <View style={styles.link}>
                <Lucide name="key-round" size={16} color={colors.accent} />
                <Text style={styles.title}>Your key ··· {geminiKey!.slice(-4)}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Pressable onPress={() => setEditing(true)} hitSlop={8}>
                  <Text style={styles.linkText}>Change</Text>
                </Pressable>
                <Pressable onPress={() => setGeminiKey(undefined)} hitSlop={8}>
                  <Text style={[styles.linkText, { color: colors.danger }]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  cardSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceHi },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 2 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  keyBox: { gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.surface },
  input: {
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  save: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  saveText: { color: colors.accentInk, fontSize: 15, fontWeight: '700' },
});
