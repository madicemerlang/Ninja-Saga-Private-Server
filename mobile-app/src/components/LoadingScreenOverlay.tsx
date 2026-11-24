import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

const LOADING_BG = require('../../assets/loading_bg.jpg');
const IMG_W = 1844;
const IMG_H = 853;
// Built-in dark rounded loading bar slot inside loading_bg.jpg (1844x853)
const BAR_X0 = 714;
const BAR_X1 = 1130;
const BAR_Y0 = 758;
const BAR_Y1 = 801;

interface LoadingScreenOverlayProps {
  visible: boolean;
  subtitle?: string;
  progress?: number; // Optional real 0..1 progress from resource preloader
}

export function LoadingScreenOverlay({ visible, subtitle, progress }: LoadingScreenOverlayProps) {
  const win = useWindowDimensions();
  const [size, setSize] = useState({ width: win.width, height: win.height });
  const [mounted, setMounted] = useState(visible);
  const [dots, setDots] = useState('...');

  const fadeAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const progressAnim = useRef(new Animated.Value(0.08)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  // Cycling "Loading." -> "Loading.." -> "Loading..."
  useEffect(() => {
    if (!mounted) return;
    const states = ['.', '..', '...'];
    let idx = 0;
    const iv = setInterval(() => {
      idx = (idx + 1) % states.length;
      setDots(states[idx]);
    }, 360);
    return () => clearInterval(iv);
  }, [mounted]);

  // Continuous shimmer sweep & spinning ninja star animation
  useEffect(() => {
    if (!mounted) return;
    const shimmerLoop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    const spinLoop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    shimmerLoop.start();
    spinLoop.start();
    return () => {
      shimmerLoop.stop();
      spinLoop.stop();
    };
  }, [mounted, shimmerAnim, spinAnim]);

  // Progress bar fill & smooth fade-out transition
  useEffect(() => {
    if (visible) {
      setMounted(true);
      fadeAnim.setValue(1);
      if (typeof progress === 'number') {
        Animated.timing(progressAnim, {
          toValue: Math.max(0.05, Math.min(1, progress)),
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      } else {
        progressAnim.setValue(0.08);
        Animated.timing(progressAnim, {
          toValue: 0.88,
          duration: 2400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      }
    } else if (mounted) {
      Animated.sequence([
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, progress, mounted, fadeAnim, progressAnim]);

  if (!mounted) return null;

  // Exact `resizeMode="cover"` projection so our animated bar fills the artwork's built-in slot!
  const scale = Math.max(size.width / IMG_W, size.height / IMG_H);
  const offsetX = (size.width - IMG_W * scale) / 2;
  const offsetY = (size.height - IMG_H * scale) / 2;

  const barLeft = offsetX + BAR_X0 * scale;
  const barTop = offsetY + BAR_Y0 * scale;
  const barWidth = Math.max(120, (BAR_X1 - BAR_X0) * scale);
  const barHeight = Math.max(14, (BAR_Y1 - BAR_Y0) * scale);

  const fillWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const shimmerX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-60, barWidth + 40],
  });

  const spinDeg = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={[styles.overlay, { opacity: fadeAnim }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) {
          setSize((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height }
          );
        }
      }}
    >
      <Image source={LOADING_BG} style={styles.bgImg} resizeMode="cover" />

      {/* "Loading..." label + spinning ninja star directly above the loading bar */}
      <View
        style={[
          styles.labelWrap,
          {
            left: barLeft,
            width: barWidth,
            top: Math.max(12, barTop - 30),
          },
        ]}
      >
        <Animated.Text style={[styles.spinnerGlyph, { transform: [{ rotate: spinDeg }] }]}>
          ✦
        </Animated.Text>
        <Text style={styles.loadingText} numberOfLines={1}>
          {subtitle
            ? `${subtitle}${typeof progress === 'number' ? ` (${Math.round(progress * 100)}%)` : dots}`
            : `Loading${dots}`}
        </Text>
      </View>

      {/* Animated Golden-Orange Progress Bar Fill inside the artwork's built-in slot */}
      <View
        style={[
          styles.barSlot,
          {
            left: barLeft,
            top: barTop,
            width: barWidth,
            height: barHeight,
            borderRadius: Math.max(5, barHeight * 0.28),
          },
        ]}
      >
        <Animated.View style={[styles.barFill, { width: fillWidth }]}>
          <View style={styles.barTopGlow} />
          <Animated.View
            style={[
              styles.shimmerStreak,
              { transform: [{ translateX: shimmerX }, { skewX: '-20deg' }] },
            ]}
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0B1220',
    zIndex: 90,
  },
  bgImg: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  labelWrap: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  spinnerGlyph: {
    color: '#FDE047',
    fontSize: 16,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
    textShadowColor: '#000000',
    textShadowOffset: { width: 1.5, height: 1.5 },
    textShadowRadius: 4,
  },
  barSlot: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'rgba(20, 20, 24, 0.45)',
    padding: 2,
  },
  barFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  barTopGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(254, 240, 138, 0.55)',
  },
  shimmerStreak: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.48)',
  },
});
