import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export interface TimelineTokenProps {
  id: string;
  name: string;
  agility: number;
  gauge: number; // 0 to 100
  isActive: boolean;
  isPlayer: boolean;
  isPet?: boolean;
  emoji?: string;
  turnKey?: number;
  trackWidth?: number;
}

/**
 * Ninja Horizon-styled circular ATB medallion marker that glides at locked 60 FPS
 * on the native GPU compositor (`useNativeDriver: true` via `translateX` + `scale`).
 */
export const TimelineToken = React.memo(function TimelineToken({
  name,
  gauge,
  isActive,
  isPlayer,
  isPet,
  emoji,
  turnKey,
  trackWidth = 360,
}: TimelineTokenProps) {
  const animGauge = useRef(new Animated.Value(gauge)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const prevTurnKeyRef = useRef(turnKey);

  useEffect(() => {
    const isConsecutiveTurn =
      turnKey !== undefined &&
      turnKey !== prevTurnKeyRef.current &&
      isActive &&
      gauge >= 100;

    prevTurnKeyRef.current = turnKey;

    if (isConsecutiveTurn) {
      animGauge.setValue(0);
      Animated.timing(animGauge, {
        toValue: 100,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    const isReset = gauge === 0;
    Animated.timing(animGauge, {
      toValue: Math.max(0, Math.min(100, gauge)),
      duration: isReset ? 160 : 380,
      easing: isReset ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [gauge, turnKey, isActive, animGauge]);

  useEffect(() => {
    if (isActive) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 300,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 300,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isActive, pulseAnim]);

  const usableW = Math.max(80, trackWidth);
  const startX = usableW * 0.02 - 12;
  const endX = usableW * 0.98 - 12;
  const translateX = animGauge.interpolate({
    inputRange: [0, 100],
    outputRange: [startX, endX],
    extrapolate: 'clamp',
  });

  const displayEmoji = emoji ?? (isPet ? '🐾' : isPlayer ? '🥷' : '👺');

  return (
    <Animated.View
      renderToHardwareTextureAndroid
      style={[
        styles.markerWrap,
        isActive && styles.markerActiveZ,
        {
          transform: [{ translateX }, { scale: pulseAnim }],
        },
      ]}
    >
      <View
        style={[
          styles.medallion,
          isPet ? styles.petRing : isPlayer ? styles.playerRing : styles.enemyRing,
          isActive && styles.activeRing,
        ]}
      >
        <Text style={styles.emoji}>{displayEmoji}</Text>
      </View>
      <View
        style={[
          styles.tagPill,
          isPet ? styles.petTag : isPlayer ? styles.playerTag : styles.enemyTag,
          isActive && styles.activeTag,
        ]}
      >
        <Text style={styles.tagText} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  markerWrap: {
    position: 'absolute',
    left: 0,
    top: -4,
    alignItems: 'center',
    zIndex: 10,
  },
  markerActiveZ: {
    zIndex: 25,
  },
  medallion: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.75,
    shadowRadius: 3,
    elevation: 4,
  },
  playerRing: {
    backgroundColor: '#0C4A6E',
    borderColor: '#38BDF8',
  },
  petRing: {
    backgroundColor: '#115E59',
    borderColor: '#2DD4BF',
  },
  enemyRing: {
    backgroundColor: '#7F1D1D',
    borderColor: '#F87171',
  },
  activeRing: {
    backgroundColor: '#B45309',
    borderColor: '#FACC15',
    borderWidth: 2.2,
    shadowColor: '#FACC15',
    shadowOpacity: 0.95,
    shadowRadius: 6,
  },
  emoji: {
    fontSize: 11,
  },
  tagPill: {
    marginTop: 1,
    paddingHorizontal: 3.5,
    paddingVertical: 0.5,
    borderRadius: 4,
    borderWidth: 0.75,
  },
  playerTag: {
    backgroundColor: 'rgba(2, 132, 199, 0.9)',
    borderColor: '#7DD3FC',
  },
  petTag: {
    backgroundColor: 'rgba(13, 148, 136, 0.9)',
    borderColor: '#5EEAD4',
  },
  enemyTag: {
    backgroundColor: 'rgba(185, 28, 28, 0.9)',
    borderColor: '#FCA5A5',
  },
  activeTag: {
    backgroundColor: '#D97706',
    borderColor: '#FEF08A',
  },
  tagText: {
    color: '#FFFFFF',
    fontSize: 6.5,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
});
