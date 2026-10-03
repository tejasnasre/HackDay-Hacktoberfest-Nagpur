import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '@/constants/colors';
import { VoiceProvider } from '@/voice/VoiceProvider';

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg } };

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemeProvider value={theme}>
        <VoiceProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
            <Stack.Screen name="settings" />
          </Stack>
        </VoiceProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
