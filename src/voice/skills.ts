import type { ToolDefinition } from 'react-native-executorch/llm';

import { logMood, moodsSince, recallFacts, rememberFact, updateMemory } from './memoryStore';
import type { VoiceStyle } from './persona';

export type RitualType = 'breathing' | 'goodnight' | 'checkin';

/** Signals from skills to the voice loop (there is only one call at a time). */
export const callSignals = { endRequested: false };

function setVoiceStyle(style: VoiceStyle) {
  void updateMemory(() => ({ voiceStyle: style }));
}

const RITUALS: Record<RitualType, string> = {
  breathing:
    'Guide a slow box-breathing round: in for four, hold for four, out for four, hold for four. Speak calmly, one step per sentence, three rounds.',
  goodnight:
    'Lead a short goodnight wind-down: ask for one good thing from today, then help them relax their body from shoulders to toes, and wish them sleep.',
  checkin:
    'Do a gentle check-in: ask how their body feels, how their heart feels, and one thing they need tonight. One question at a time.',
};

const VALENCE: Record<string, number> = {
  happy: 2,
  excited: 2,
  loved: 2,
  grateful: 2,
  hopeful: 1,
  calm: 1,
  content: 1,
  okay: 0,
  bored: -1,
  tired: -1,
  anxious: -2,
  stressed: -2,
  lonely: -2,
  sad: -2,
  angry: -2,
  hurt: -2,
};

function valence(mood: string): number {
  return VALENCE[mood] ?? 0;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

export const HUM_SKILLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Save a lasting fact the user shared about themselves, like their name, job, crush, or a worry.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short label, e.g. "name" or "ex partner"' },
          value: { type: 'string', description: 'The fact itself' },
        },
        required: ['key', 'value'],
      },
    },
    execute: async (args) => {
      await rememberFact(asString(args.key, 'note'), asString(args.value));
      return 'saved';
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description: 'Look up facts remembered about the user on a topic.',
      parameters: {
        type: 'object',
        properties: { topic: { type: 'string', description: 'What to look up' } },
        required: ['topic'],
      },
    },
    execute: (args) => {
      const facts = recallFacts(asString(args.topic));
      return facts.length
        ? facts
            .slice(-6)
            .map((f) => `${f.key}: ${f.value}`)
            .join('; ')
        : 'nothing remembered about that';
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_mood',
      description: 'Record how the user is feeling right now.',
      parameters: {
        type: 'object',
        properties: {
          mood: {
            type: 'string',
            enum: Object.keys(VALENCE),
            description: 'One word mood',
          },
          intensity: { type: 'integer', description: '1 (mild) to 5 (strong)' },
          note: { type: 'string', description: 'Why, in a few words' },
        },
        required: ['mood'],
      },
    },
    execute: async (args) => {
      const intensity = Math.min(5, Math.max(1, Number(args.intensity) || 3));
      await logMood(asString(args.mood, 'okay'), intensity, args.note ? asString(args.note) : undefined);
      return 'logged';
    },
  },
  {
    type: 'function',
    function: {
      name: 'mood_trend',
      description: 'Summarize how the user has been feeling over recent days.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'integer', description: 'How many days back, default 7' } },
      },
    },
    execute: (args) => {
      const days = Math.min(90, Math.max(1, Number(args.days) || 7));
      const entries = moodsSince(days);
      if (entries.length === 0) return `no moods logged in the last ${days} days`;
      const half = Math.floor(entries.length / 2) || 1;
      const avg = (list: typeof entries) =>
        list.reduce((s, m) => s + valence(m.mood) * m.intensity, 0) / Math.max(1, list.length);
      const delta = avg(entries.slice(half)) - avg(entries.slice(0, half));
      const counts = new Map<string, number>();
      entries.forEach((m) => counts.set(m.mood, (counts.get(m.mood) ?? 0) + 1));
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([m]) => m);
      const direction = delta > 0.5 ? 'lighter lately' : delta < -0.5 ? 'heavier lately' : 'fairly steady';
      return `${entries.length} entries over ${days} days, mostly ${top.join(', ')}, trend ${direction}`;
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_voice_style',
      description: 'Change how you sound: warm, playful or calm.',
      parameters: {
        type: 'object',
        properties: { style: { type: 'string', enum: ['warm', 'playful', 'calm'] } },
        required: ['style'],
      },
    },
    execute: (args) => {
      const style = asString(args.style) as VoiceStyle;
      if (!['warm', 'playful', 'calm'].includes(style)) return 'unknown style';
      setVoiceStyle(style);
      return `voice is now ${style}`;
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_ritual',
      description: 'Start a guided ritual: breathing, goodnight wind-down, or check-in.',
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['breathing', 'goodnight', 'checkin'] } },
        required: ['type'],
      },
    },
    execute: (args) => {
      const type = asString(args.type) as RitualType;
      if (type === 'breathing' || type === 'goodnight') setVoiceStyle('calm');
      return RITUALS[type] ?? 'unknown ritual';
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_call',
      description: 'End the conversation after saying a short goodbye, when the user wants to stop.',
      parameters: { type: 'object', properties: {} },
    },
    execute: () => {
      callSignals.endRequested = true;
      return 'call will end after your goodbye';
    },
  },
];
