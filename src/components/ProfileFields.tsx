import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/colors';
import { LANGUAGES, PERSONAS, type Language } from '@/voice/persona';
import { useVoice } from '@/voice/VoiceProvider';

/** The user's name and the language they talk in. */
export function ProfileFields() {
  const { data, updateProfile } = useVoice();
  const [name, setName] = useState(data?.userName ?? '');
  const language = data?.language ?? 'en';
  const persona = PERSONAS[data?.persona ?? 'female'];
  const companion = persona.name;

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed === (data?.userName ?? '')) return;
    void updateProfile({ userName: trimmed || undefined });
  };

  const pick = (id: Language) => {
    if (id === language) return;
    void Haptics.selectionAsync();
    void updateProfile({ language: id });
  };

  return (
    <View style={styles.box}>
      <Text style={styles.label}>Your name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        onEndEditing={saveName}
        onBlur={saveName}
        placeholder={`What should ${companion} call you?`}
        placeholderTextColor={colors.textDim}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        style={styles.input}
        accessibilityLabel="Your name"
      />

      <Text style={[styles.label, { marginTop: 8 }]}>Talk in</Text>
      <View style={styles.segment} accessibilityRole="radiogroup">
        {(Object.keys(LANGUAGES) as Language[]).map((id) => {
          const selected = id === language;
          return (
            <Pressable
              key={id}
              onPress={() => pick(id)}
              style={[styles.option, selected && styles.optionSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={LANGUAGES[id].label}>
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{LANGUAGES[id].native}</Text>
            </Pressable>
          );
        })}
      </View>
      {language === 'hi' && (
        <Text style={styles.hint}>{companion} will listen and answer in Hindi. Switching downloads {persona.role === 'girlfriend' ? 'her' : 'his'} Hindi voice once.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, padding: 18, borderRadius: 20, backgroundColor: colors.surface },
  label: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
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
  segment: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceHi },
  optionText: { color: colors.textDim, fontSize: 16, fontWeight: '600' },
  optionTextSelected: { color: colors.text },
});
