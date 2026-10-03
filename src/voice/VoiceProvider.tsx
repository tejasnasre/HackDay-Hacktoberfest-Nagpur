import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { loadMemory, subscribeMemory, updateMemory, type HumData } from './memoryStore';
import type { PersonaId } from './persona';
import { useVoiceLoop, type VoiceLoop } from './useVoiceLoop';

type VoiceContextValue = {
  /** Undefined until the memory file has been read. */
  data: HumData | undefined;
  loop: VoiceLoop;
  choosePersona: (id: PersonaId) => Promise<void>;
  acceptModels: () => Promise<void>;
  setRememberEnabled: (on: boolean) => Promise<void>;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<HumData | undefined>();

  useEffect(() => {
    let alive = true;
    void loadMemory().then((d) => alive && setData(d));
    const unsubscribe = subscribeMemory(setData);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // Models only start downloading once the user agreed to the ~3 GB download.
  const loop = useVoiceLoop({ persona: data?.persona, enabled: !!data?.modelsAccepted });

  const value: VoiceContextValue = {
    data,
    loop,
    choosePersona: (id) => updateMemory(() => ({ persona: id, voiceStyle: 'warm' })),
    acceptModels: () => updateMemory(() => ({ modelsAccepted: true })),
    setRememberEnabled: (on) => updateMemory(() => ({ rememberEnabled: on })),
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used inside <VoiceProvider>');
  return ctx;
}
