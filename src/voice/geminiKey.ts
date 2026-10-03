import * as SecureStore from 'expo-secure-store';

const KEY_ALIAS = 'hum.gemini.apiKey';
const OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const GEMINI_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.5-flash-lite';

/**
 * Optional key baked in at build time (e.g. for a demo build). It ships inside
 * the app bundle, so only use a restricted key. A key the user enters wins.
 */
export const BUILT_IN_GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim() || undefined;

/** The user's own Gemini API key, kept in the Keychain / Android Keystore. */
export async function loadGeminiKey(): Promise<string | undefined> {
  try {
    return (await SecureStore.getItemAsync(KEY_ALIAS, OPTS)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function saveGeminiKey(key: string | undefined): Promise<void> {
  const trimmed = key?.trim();
  if (trimmed) await SecureStore.setItemAsync(KEY_ALIAS, trimmed, OPTS);
  else await SecureStore.deleteItemAsync(KEY_ALIAS, OPTS);
}
