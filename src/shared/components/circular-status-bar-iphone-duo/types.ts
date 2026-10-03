import type { StyleProp, ViewStyle } from "react-native";
import type { SharedValue } from "react-native-reanimated";

type TCircularStatusBarIphoneDuoPhase = readonly [number, number];

interface ICircularStatusBarIphoneDuoSignalPose {
  cx: number;
  cy: number;
  height: number;
}

interface ICircularStatusBarIphoneDuoWifiPose {
  cx: number;
  cy: number;
  scale: number;
}

interface ICircularStatusBarIphoneDuoBatteryPose {
  cx: number;
  cy: number;
  width: number;
  height: number;
  capX: number;
  capScale: number;
}

interface ICircularStatusBarIphoneDuoArcPose {
  cx: number;
  cy: number;
  angle: number;
  curvature: number;
  length: number;
}

interface ICircularStatusBarIphoneDuo {
  readonly size?: number;
  readonly color?: string;
  readonly speed?: number;
  readonly loop?: boolean;
  readonly loopDelay?: number;
  readonly autoPlay?: boolean;
  readonly reverse?: boolean;
  /** Draw the Wi-Fi glyph inside the ring; turn off to place your own icon there. */
  readonly showWifi?: boolean;
  readonly progress?: SharedValue<number>;
  readonly onAnimationEnd?: () => void;
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<ViewStyle>;
}

export type {
  TCircularStatusBarIphoneDuoPhase,
  ICircularStatusBarIphoneDuoSignalPose,
  ICircularStatusBarIphoneDuoWifiPose,
  ICircularStatusBarIphoneDuoBatteryPose,
  ICircularStatusBarIphoneDuoArcPose,
  ICircularStatusBarIphoneDuo,
};
