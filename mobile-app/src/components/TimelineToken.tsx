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
}

/**
 * Ninja Horizon-styled circular ATB medallion marker that glides smoothly
 * along the golden top-center ATB rail toward the ACT emblem.
 */
export function TimelineToken({
  name,
  gauge,
  isActive,
  isPlayer,
  isPet,
  emoji,
  turnKey,
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
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
      return;
    }

    const isReset = gauge === 0;
    Animated.timing(animGauge, {
      toValue: Math.max(0, Math.min(100, gauge)),
      duration: isReset ? 200 : 460,
      easing: isReset ? Easing.linear : Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [gauge, turnKey, isActive, animGauge]);

  useEffect(() => {
    if (isActive) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.16,
            duration: 320,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 320,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isActive, pulseAnim]);

  const leftInterpolated = animGauge.interpolate({
    inputRange: [0, 100],
    outputRange: ['2%', '98%'],
    extrapolate: 'clamp',
  });

  const displayEmoji = emoji ?? (isPet ? '🐾' : isPlayer ? '🥷' : '👺');

  return (
    <Animated.View
      style={[
        styles.markerWrap,
        isActive && styles.markerActiveZ,
        {
          left: leftInterpolated,
          transform: [{ translateX: -12 }, { scale: pulseAnim }],
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
}

const styles = StyleSheet.create({
  markerWrap: {
    position: 'absolute',
    top: -6,
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
