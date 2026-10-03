import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { BUILT_IN_GEMINI_KEY, GEMINI_MODEL, loadGeminiKey, saveGeminiKey } from './geminiKey';
import { loadMemory, subscribeMemory, updateMemory, type BrainEngine, type HumData } from './memoryStore';
import type { PersonaId } from './persona';
import { useVoiceLoop, type VoiceLoop } from './useVoiceLoop';

type VoiceContextValue = {
  /** Undefined until the memory file has been read. */
  data: HumData | undefined;
  loop: VoiceLoop;
  /** The user's own Gemini key, if they saved one. */
  geminiKey: string | undefined;
  /** True when Gemini can run: the user's key or one built into the app. */
  geminiAvailable: boolean;
  choosePersona: (id: PersonaId) => Promise<void>;
  acceptModels: () => Promise<void>;
  setRememberEnabled: (on: boolean) => Promise<void>;
  setEngine: (engine: BrainEngine) => Promise<void>;
  setGeminiKey: (key: string | undefined) => Promise<void>;
  updateProfile: (patch: Partial<Pick<HumData, 'language' | 'userName' | 'customPrompt'>>) => Promise<void>;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<HumData | undefined>();
  const [geminiKey, setKey] = useState<string | undefined>();
  const [keyLoaded, setKeyLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadMemory().then((d) => alive && setData(d));
    void loadGeminiKey().then((k) => {
      if (!alive) return;
      setKey(k);
      setKeyLoaded(true);
    });
    const unsubscribe = subscribeMemory(setData);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // The user's own key wins over a key built into the app.
  const apiKey = geminiKey ?? BUILT_IN_GEMINI_KEY;
  const wantsGemini = data?.engine === 'gemini';
  const useGemini = wantsGemini && !!apiKey;
  const cloud = useMemo(() => (useGemini ? { apiKey: apiKey!, model: GEMINI_MODEL } : undefined), [useGemini, apiKey]);

  // Models only start downloading once the user agreed to the download, and
  // not before the key is read (or while Gemini is chosen without one), so
  // Gemma is never fetched by mistake.
  const enabled = !!data?.modelsAccepted && keyLoaded && (!wantsGemini || useGemini);
  const loop = useVoiceLoop({
    persona: data?.persona,
    enabled,
    cloud,
    language: data?.language ?? 'en',
    userName: data?.userName,
    customPrompt: data?.customPrompt,
  });

  const value: VoiceContextValue = {
    data,
    loop,
    geminiKey,
    geminiAvailable: !!apiKey,
    choosePersona: (id) => updateMemory(() => ({ persona: id, voiceStyle: 'warm' })),
    acceptModels: () => updateMemory(() => ({ modelsAccepted: true })),
    setRememberEnabled: (on) => updateMemory(() => ({ rememberEnabled: on })),
    setEngine: (engine) => updateMemory(() => ({ engine })),
    setGeminiKey: async (key) => {
      await saveGeminiKey(key);
      setKey(key?.trim() || undefined);
    },
    updateProfile: (patch) => updateMemory(() => patch),
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used inside <VoiceProvider>');
  return ctx;
}
