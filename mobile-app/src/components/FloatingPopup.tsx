import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import type { FloatingNumber } from '../engine/battleEngine';

interface FloatingPopupProps {
  item: FloatingNumber;
  index: number;
  speedMultiplier?: 1 | 2;
  onDone?: (id: number) => void;
}

export function FloatingPopup({
  item,
  index,
  speedMultiplier = 1,
  onDone,
}: FloatingPopupProps) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.65)).current;

  useEffect(() => {
    const dur = speedMultiplier === 2 ? 520 : 880;
    const popDur = speedMultiplier === 2 ? 110 : 170;

    Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, {
          toValue: item.kind === 'crit' ? 1.25 : 1.05,
          duration: popDur,
          easing: Easing.out(Easing.back(2)),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(translateY, {
        toValue: -46 - index * 6,
        duration: dur,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.delay(Math.max(180, dur - 280)),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 190,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      onDone?.(item.id);
    });
  }, [item.id, item.kind, index, speedMultiplier, onDone, opacity, scale, translateY]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          marginTop: index * 2,
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          item.kind === 'crit' && styles.crit,
          item.kind === 'cp' && styles.cp,
          item.kind === 'dodge' && styles.dodge,
          item.kind === 'heal' && styles.heal,
          item.kind === 'buff' && styles.buff,
          item.kind === 'debuff' && styles.debuff,
        ]}
      >
        {item.text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 21,
    fontWeight: '900',
    color: '#EF4444',
    textShadowColor: '#000',
    textShadowOffset: { width: 1.5, height: 1.5 },
    textShadowRadius: 3,
    letterSpacing: 0.4,
  },
  crit: {
    color: '#FACC15',
    fontSize: 25,
  },
  cp: {
    color: '#38BDF8',
    fontSize: 18,
  },
  dodge: {
    color: '#A3E635',
    fontSize: 22,
  },
  heal: {
    color: '#4ADE80',
    fontSize: 20,
  },
  buff: {
    color: '#FB923C',
    fontSize: 15,
  },
  debuff: {
    color: '#E879F9',
    fontSize: 15,
  },
});
