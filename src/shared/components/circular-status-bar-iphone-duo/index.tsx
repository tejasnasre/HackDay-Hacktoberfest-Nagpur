import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import {
  Canvas,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  createPicture,
  type SkPicture,
} from "@shopify/react-native-skia";
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import type { ICircularStatusBarIphoneDuo } from "./types";
import {
  BATTERY,
  BATTERY_CAP_PATH,
  DEFAULT_ACCESSIBILITY_LABEL,
  DEFAULT_COLOR,
  DEFAULT_LOOP_DELAY,
  DEFAULT_SIZE,
  DEFAULT_SPEED,
  LINE_WIDTH,
  SIGNAL,
  SWAP_AT,
  TIMELINE_LENGTH,
  VIEW_BOX,
  WIFI,
  WIFI_INNER_PATH,
  WIFI_OUTER_PATH,
  WIFI_WEDGE_PATH,
} from "./conf";
import {
  arcPose,
  batteryPose,
  signalPose,
  traceArc,
  wifiPose,
} from "./helper";

const WIFI_OUTER = Skia.Path.MakeFromSVGString(WIFI_OUTER_PATH)!;
const WIFI_INNER = Skia.Path.MakeFromSVGString(WIFI_INNER_PATH)!;
const WIFI_WEDGE = Skia.Path.MakeFromSVGString(WIFI_WEDGE_PATH)!;
const BATTERY_CAP = Skia.Path.MakeFromSVGString(BATTERY_CAP_PATH)!;

export const CircularStatusBarIphoneDuo: React.FC<ICircularStatusBarIphoneDuo> = ({
  size = DEFAULT_SIZE,
  color = DEFAULT_COLOR,
  speed = DEFAULT_SPEED,
  loop = true,
  loopDelay = DEFAULT_LOOP_DELAY,
  autoPlay = true,
  reverse = false,
  showWifi = true,
  progress,
  onAnimationEnd,
  accessibilityLabel = DEFAULT_ACCESSIBILITY_LABEL,
  style,
}: ICircularStatusBarIphoneDuo): React.JSX.Element => {
  const internalProgress = useSharedValue<number>(0);
  const driver = progress ?? internalProgress;

  const onAnimationEndRef =
    useRef<ICircularStatusBarIphoneDuo["onAnimationEnd"]>(onAnimationEnd);
  onAnimationEndRef.current = onAnimationEnd;
  const handleAnimationEnd = useCallback<() => void>(
    () => onAnimationEndRef.current?.(),
    [],
  );

  useEffect(() => {
    if (progress) return;

    cancelAnimation<number>(internalProgress);
    internalProgress.value = 0;

    if (!autoPlay) return;

    const rate = Math.max(speed, 0.01);
    const config = {
      duration: (TIMELINE_LENGTH * 1000) / rate,
      easing: Easing.linear,
    };
    const hold = (value: number) =>
      withDelay<number>(
        loopDelay / rate,
        withTiming<number>(value, { duration: 0 }),
      );

    if (!loop) {
      internalProgress.value = withTiming<number>(1, config, (finished) => {
        if (finished) scheduleOnRN(handleAnimationEnd);
      });
    } else if (reverse) {
      internalProgress.value = withRepeat<number>(
        withSequence<number>(
          withTiming<number>(1, config),
          hold(1),
          withTiming<number>(0, config),
          hold(0),
        ),
        -1,
        false,
      );
    } else {
      internalProgress.value = withRepeat<number>(
        withSequence<number>(withTiming<number>(1, config), hold(1)),
        -1,
        false,
      );
    }

    return () => cancelAnimation<number>(internalProgress);
  }, [
    internalProgress,
    progress,
    autoPlay,
    loop,
    reverse,
    speed,
    loopDelay,
    handleAnimationEnd,
  ]);

  const width = size;
  const height = (size * VIEW_BOX.height) / VIEW_BOX.width;
  const scale = size / VIEW_BOX.width;

  const paints = useMemo(() => {
    const fill = Skia.Paint();
    fill.setAntiAlias(true);
    fill.setColor(Skia.Color(color));

    const cap = fill.copy();

    const wifi = fill.copy();
    wifi.setStyle(PaintStyle.Stroke);
    wifi.setStrokeCap(StrokeCap.Round);
    wifi.setStrokeWidth(WIFI.arcWidth);

    const arc = wifi.copy();
    arc.setStrokeWidth(LINE_WIDTH);

    return { fill, cap, wifi, arc };
  }, [color]);

  const picture = useDerivedValue<SkPicture>(() => {
    const time = Math.min(Math.max(driver.value, 0), 1) * TIMELINE_LENGTH;

    return createPicture(
      (canvas) => {
        canvas.save();
        canvas.scale(scale, scale);
        canvas.translate(-VIEW_BOX.x, -VIEW_BOX.y);

        for (let index = 0; index < SIGNAL.count; index++) {
          const bar = signalPose(index, time);
          const radius = Math.min(SIGNAL.width, bar.height) / 2;
          canvas.drawRRect(
            Skia.RRectXY(
              Skia.XYWHRect(
                bar.cx - SIGNAL.width / 2,
                bar.cy - bar.height / 2,
                SIGNAL.width,
                bar.height,
              ),
              radius,
              radius,
            ),
            paints.fill,
          );
        }

        if (showWifi) {
          const glyph = wifiPose(time);
          canvas.save();
          canvas.translate(glyph.cx, glyph.cy);
          canvas.scale(glyph.scale, glyph.scale);
          canvas.translate(-WIFI.width / 2, -WIFI.height / 2);
          canvas.drawPath(WIFI_OUTER, paints.wifi);
          canvas.drawPath(WIFI_INNER, paints.wifi);
          canvas.drawPath(WIFI_WEDGE, paints.fill);
          canvas.restore();
        }

        if (time < SWAP_AT) {
          const body = batteryPose(time);
          const corner = Math.min(BATTERY.radius, body.width / 2);
          canvas.drawRRect(
            Skia.RRectXY(
              Skia.XYWHRect(
                body.cx - body.width / 2,
                body.cy - body.height / 2,
                body.width,
                body.height,
              ),
              corner,
              corner,
            ),
            paints.fill,
          );

          if (body.capScale > 0.001) {
            paints.cap.setAlphaf(body.capScale);
            canvas.save();
            canvas.translate(body.capX, body.cy);
            canvas.scale(body.capScale, body.capScale);
            canvas.translate(0, -BATTERY.capHeight / 2);
            canvas.drawPath(BATTERY_CAP, paints.cap);
            canvas.restore();
          }
        } else {
          canvas.drawPath(
            traceArc(Skia.Path.Make(), arcPose(time)),
            paints.arc,
          );
        }

        canvas.restore();
      },
      { width, height },
    );
  });

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[{ width, height }, style]}
    >
      <Canvas style={{ width, height }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
};

export default memo<React.FC<ICircularStatusBarIphoneDuo>>(CircularStatusBarIphoneDuo);
