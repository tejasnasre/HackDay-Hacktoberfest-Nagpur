import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '@/constants/colors';
import { VoiceProvider } from '@/voice/VoiceProvider';

// react-native-executorch is built with execution profiling on and logs every model call
// ("Execution of method 'decode' took 296 ms"). Drop those lines, keep every other log.
const log = console.log;
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('Execution of method')) return;
  log(...args);
};

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
