import { Lucide } from '@react-native-vector-icons/lucide';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrainPicker } from '@/components/BrainPicker';
import { PersonaPromptEditor } from '@/components/PersonaPromptEditor';
import { ProfileFields } from '@/components/ProfileFields';
import { colors } from '@/constants/colors';

export default function Settings() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityLabel="Back">
          <Lucide name="chevron-left" size={22} color={colors.textDim} />
        </Pressable>
        <Text style={styles.title}>About you</Text>
        <ProfileFields />
        <PersonaPromptEditor />
        <Text style={[styles.title, { marginTop: 16 }]}>Hum’s brain</Text>
        <Text style={styles.body}>Choose where Hum thinks. You can switch anytime; your memories stay on this phone.</Text>
        <BrainPicker />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingTop: 48, gap: 14 },
  back: { marginBottom: 8, alignSelf: 'flex-start' },
  title: { color: colors.text, fontSize: 30, fontWeight: '700', lineHeight: 36, marginBottom: 4 },
  body: { color: colors.textDim, fontSize: 16, lineHeight: 23, marginBottom: 12 },
});
