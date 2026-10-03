import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/colors';
import { PERSONAS } from '@/voice/persona';
import { useVoice } from '@/voice/VoiceProvider';

const MAX_CHARS = 1200;

/** The user's own instructions for how their companion should be. */
export function PersonaPromptEditor() {
  const { data, updateProfile } = useVoice();
  const saved = data?.customPrompt ?? '';
  const [draft, setDraft] = useState(saved);
  const persona = PERSONAS[data?.persona ?? 'female'];
  const dirty = draft.trim() !== saved;
  const [their, they] = persona.role === 'girlfriend' ? ['Her', 'she'] : ['His', 'he'];

  const save = async () => {
    await updateProfile({ customPrompt: draft.trim() || undefined });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.label}>How {persona.name} should be</Text>
      <Text style={styles.hint}>
        {their} backstory, how {they} talks to you, nicknames, likes and moods.{' '}
        {persona.name} follows this on every call.
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={
          persona.role === 'girlfriend'
            ? 'e.g. You are from Pune, you study design. Call me "jaanu". Be extra flirty at night and scold me if I skip dinner.'
            : 'e.g. You are from Delhi, you play guitar. Call me "babe". Hype me up before exams and make me laugh when I am low.'
        }
        placeholderTextColor={colors.textDim}
        multiline
        maxLength={MAX_CHARS}
        textAlignVertical="top"
        style={styles.input}
        accessibilityLabel={`How ${persona.name} should be`}
      />
      <View style={styles.actions}>
        <Text style={styles.count}>
          {draft.length}/{MAX_CHARS}
        </Text>
        <Pressable onPress={save} disabled={!dirty} style={[styles.save, !dirty && { opacity: 0.4 }]}>
          <Text style={styles.saveText}>{dirty ? 'Save' : 'Saved'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10, padding: 18, borderRadius: 20, backgroundColor: colors.surface },
  label: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 140,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: colors.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
  save: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  saveText: { color: colors.accentInk, fontSize: 15, fontWeight: '700' },
});
