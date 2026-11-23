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
  emoji?: string;
  turnKey?: number;
}

export function TimelineToken({
  name,
  agility,
  gauge,
  isActive,
  isPlayer,
  emoji,
  turnKey,
}: TimelineTokenProps) {
  const animGauge = useRef(new Animated.Value(gauge)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const prevTurnKeyRef = useRef(turnKey);

  // Smooth slide across timeline when gauge changes or when actor gets consecutive turn
  useEffect(() => {
    const isConsecutiveTurn =
      turnKey !== undefined &&
      turnKey !== prevTurnKeyRef.current &&
      isActive &&
      gauge === 100;

    prevTurnKeyRef.current = turnKey;

    if (isConsecutiveTurn) {
      // Snap to 0 immediately so the token visibly slides all the way from start to finish again!
      animGauge.setValue(0);
      Animated.timing(animGauge, {
        toValue: 100,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
      return;
    }

    const isReset = gauge === 0;
    Animated.timing(animGauge, {
      toValue: Math.max(0, Math.min(100, gauge)),
      duration: isReset ? 220 : 520,
      easing: isReset ? Easing.linear : Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [gauge, turnKey, isActive, animGauge]);

  // Gentle breathing/pulse animation when token reaches 100% (READY)
  useEffect(() => {
    if (isActive) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.12,
            duration: 340,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 340,
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
    outputRange: ['1%', '89%'],
    extrapolate: 'clamp',
  });

  const displayEmoji = emoji ?? (isPlayer ? '🥷' : '👺');

  return (
    <Animated.View
      style={[
        styles.tokenBase,
        isPlayer ? styles.playerToken : styles.enemyToken,
        isActive && styles.activeTokenGlow,
        {
          left: leftInterpolated,
          transform: [{ scale: pulseAnim }],
        },
      ]}
    >
      <Text style={styles.tokenEmoji}>{displayEmoji}</Text>
      <Text style={styles.tokenText} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.agiBadge}>
        <Text style={styles.tokenAgi}>{agility}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tokenBase: {
    position: 'absolute',
    height: 18,
    minWidth: 44,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    justifyContent: 'center',
    borderWidth: 1,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  playerToken: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
  },
  enemyToken: {
    backgroundColor: '#DC2626',
    borderColor: '#F87171',
  },
  activeTokenGlow: {
    borderColor: '#FACC15',
    borderWidth: 1.5,
    backgroundColor: '#D97706',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 20,
  },
  tokenEmoji: {
    fontSize: 9,
    marginRight: 2,
  },
  tokenText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  agiBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: 4,
    paddingHorizontal: 2.5,
    paddingVertical: 0.5,
    marginLeft: 3,
  },
  tokenAgi: {
    fontSize: 7,
    fontWeight: '800',
    color: '#E2E8F0',
  },
});
