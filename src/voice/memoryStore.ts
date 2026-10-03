import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createMMKV, type MMKV } from 'react-native-mmkv';

import type { PersonaId, VoiceStyle } from './persona';

export type Fact = { key: string; value: string; at: number };
export type MoodEntry = { mood: string; intensity: number; note?: string; at: number };

export type HumData = {
  persona?: PersonaId;
  voiceStyle: VoiceStyle;
  /** User consented to the ~3 GB model download. */
  modelsAccepted: boolean;
  /** User opted in to keeping memories between conversations. */
  rememberEnabled: boolean;
  facts: Fact[];
  moods: MoodEntry[];
};

const MAX_FACTS = 60;
const MAX_MOODS = 400;

const DEFAULT_DATA: HumData = {
  voiceStyle: 'warm',
  modelsAccepted: false,
  rememberEnabled: true,
  facts: [],
  moods: [],
};

const STORE_ID = 'hum';
const KEY_ALIAS = 'hum.mmkv.key';
const DATA_KEYS = Object.keys(DEFAULT_DATA).concat('persona') as (keyof HumData)[];

let data: HumData = DEFAULT_DATA;
let storage: MMKV | undefined;
let loaded: Promise<HumData> | undefined;
const listeners = new Set<(d: HumData) => void>();

/**
 * The MMKV file is encrypted with AES-256. Its key is random, generated on
 * first launch and kept in the Keychain / Android Keystore, never on disk.
 */
async function getEncryptionKey(): Promise<string> {
  const opts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
  const existing = await SecureStore.getItemAsync(KEY_ALIAS, opts);
  if (existing) return existing;
  // 16 random bytes as 32 hex chars: the 32-byte maximum for AES-256 keys.
  const key = Array.from(getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_ALIAS, key, opts);
  return key;
}

function readAll(store: MMKV): HumData {
  const out: Record<string, unknown> = { ...DEFAULT_DATA };
  for (const key of DATA_KEYS) {
    const raw = store.getString(key);
    if (raw === undefined) continue;
    try {
      out[key] = JSON.parse(raw);
    } catch {
      // Unreadable value (e.g. a key mismatch after a restore): keep the default.
    }
  }
  return out as HumData;
}

export function loadMemory(): Promise<HumData> {
  loaded ??= (async () => {
    try {
      storage = createMMKV({
        id: STORE_ID,
        encryptionKey: await getEncryptionKey(),
        encryptionType: 'AES-256',
      });
      data = readAll(storage);
    } catch (e) {
      if (__DEV__) console.warn('[hum] memory load failed', e);
      data = DEFAULT_DATA;
    }
    return data;
  })();
  return loaded;
}

export function getMemory(): HumData {
  return data;
}

export function subscribeMemory(fn: (d: HumData) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persist(patch: Partial<HumData>) {
  if (!storage) return;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) storage.remove(key);
    else storage.set(key, JSON.stringify(value));
  }
}

/** Updates memory in place; MMKV writes are synchronous. */
export async function updateMemory(patch: (d: HumData) => Partial<HumData>): Promise<void> {
  if (!storage) await loadMemory();
  const changes = patch(data);
  data = { ...data, ...changes };
  listeners.forEach((fn) => fn(data));
  persist(changes);
}

export function rememberFact(key: string, value: string) {
  if (!data.rememberEnabled) return Promise.resolve();
  const k = key.trim().toLowerCase();
  return updateMemory((d) => ({
    facts: [...d.facts.filter((f) => f.key !== k), { key: k, value: value.trim(), at: Date.now() }].slice(-MAX_FACTS),
  }));
}

export function recallFacts(topic?: string): Fact[] {
  if (!topic) return data.facts;
  const words = topic
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) return data.facts;
  return data.facts.filter((f) => {
    const hay = `${f.key} ${f.value}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  });
}

export function logMood(mood: string, intensity: number, note?: string) {
  if (!data.rememberEnabled) return Promise.resolve();
  return updateMemory((d) => ({
    moods: [...d.moods, { mood: mood.toLowerCase(), intensity, note, at: Date.now() }].slice(-MAX_MOODS),
  }));
}

export function moodsSince(days: number): MoodEntry[] {
  const since = Date.now() - days * 86_400_000;
  return data.moods.filter((m) => m.at >= since);
}

/** "Forget everything": wipes facts and moods, keeps setup choices. */
export async function forgetEverything() {
  await updateMemory(() => ({ facts: [], moods: [] }));
  // Reclaim the space so deleted entries do not linger in the file.
  storage?.trim();
}

export function memoryForPrompt(): string {
  return data.facts
    .slice(-20)
    .map((f) => `- ${f.key}: ${f.value}`)
    .join('\n');
}
