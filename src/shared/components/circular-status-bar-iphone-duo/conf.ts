import type { TCircularStatusBarIphoneDuoPhase } from "./types";

const TIMELINE_LENGTH = 3.2;

const VIEW_BOX = { x: 340, y: 169.5, width: 600, height: 380 } as const;

const RING = { x: 640, y: 359.5, radius: 109 } as const;
const LINE_WIDTH = 16;

const SIGNAL = {
  count: 4,
  width: 23.5,
  heights: [44, 59, 76, 93],
  firstX: 376,
  gap: 38.5,
  baseline: 410,
  dipNear: 556,
  dipFar: 566,
} as const;

const WIFI = {
  width: 140,
  height: 110,
  startX: 623,
  startY: 360,
  endScale: 0.81,
  arcWidth: 18,
} as const;

const BATTERY = {
  height: 92,
  radius: 34,
  stretch: 0.6,
  startWidth: 178,
  startX: 832.5,
  centerY: 359.5,
  endWidth: LINE_WIDTH,
  endX: RING.x + RING.radius,
  capWidth: 12,
  capHeight: 28,
  capGap: 3.5,
} as const;

const ARC = {
  startLength: BATTERY.height - LINE_WIDTH,
  endLength: 464,
  windup: 35,
  turn: -450,
  fling: 2e-5,
  flingMax: 48,
  lean: 0.012,
  smear: 0.02,
} as const;

const PHASES: Record<
  "cap" | "battery" | "windup" | "orbit" | "curvature" | "growth" | "wifi",
  TCircularStatusBarIphoneDuoPhase
> = {
  cap: [0.62, 0.95],
  battery: [0.8, 1.38],
  windup: [1.38, 1.7],
  orbit: [1.4, 3.15],
  curvature: [1.38, 1.8],
  growth: [1.8, 3.1],
  wifi: [1.4, 2.3],
};

const SIGNAL_TIMING = {
  collapseStart: 0.9,
  collapseStagger: 0.065,
  collapseEnd: 1.42,
  collapseEndStagger: 0.035,
  flightStart: 1.84,
  flightStagger: 0.055,
  flightLength: 1.1,
} as const;

const SPRING_DECAY = 6.5;
const SPRING_ONSET = 0.16;

const SPRINGS = {
  signal: 0.66,
  flight: 0.78,
  wifi: 0.74,
  battery: 0.72,
  orbit: 0.78,
  curvature: 0.85,
  growth: 0.72,
} as const;

const SWAP_AT = PHASES.battery[1];

const WIFI_OUTER_PATH = "M15 38 Q70 -6 125 38";
const WIFI_INNER_PATH = "M38 62 Q70 37 102 62";
const WIFI_WEDGE_PATH =
  "M55 80 Q70 70 85 80 Q90 83 86 88 L76 99 Q70 106 64 99 L54 88 Q50 83 55 80 Z";
const BATTERY_CAP_PATH = "M0 0 C15.6 4.2 15.6 23.8 0 28 Z";

const DEFAULT_SIZE = 320;
const DEFAULT_COLOR = "#FFFFFF";
const DEFAULT_SPEED = 1;
const DEFAULT_LOOP_DELAY = 533;
const DEFAULT_ACCESSIBILITY_LABEL =
  "Cellular signal and battery morph into a ring around Wi-Fi";

export {
  TIMELINE_LENGTH,
  VIEW_BOX,
  RING,
  LINE_WIDTH,
  SIGNAL,
  WIFI,
  BATTERY,
  ARC,
  PHASES,
  SWAP_AT,
  SIGNAL_TIMING,
  SPRING_DECAY,
  SPRING_ONSET,
  SPRINGS,
  WIFI_OUTER_PATH,
  WIFI_INNER_PATH,
  WIFI_WEDGE_PATH,
  BATTERY_CAP_PATH,
  DEFAULT_SIZE,
  DEFAULT_COLOR,
  DEFAULT_SPEED,
  DEFAULT_LOOP_DELAY,
  DEFAULT_ACCESSIBILITY_LABEL,
};
