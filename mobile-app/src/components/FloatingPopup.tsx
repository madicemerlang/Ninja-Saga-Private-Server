import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { FloatingNumber } from '../engine/battleEngine';

interface FloatingPopupProps {
  item: FloatingNumber;
  index: number;
  speedMultiplier?: 1 | 1.5;
  onDone?: (id: number) => void;
}

const STROKE_OFFSETS: ReadonlyArray<[number, number]> = [
  [-1.6, 0],
  [1.6, 0],
  [0, -1.6],
  [0, 1.6],
  [-1.1, -1.1],
  [1.1, -1.1],
  [-1.1, 1.1],
  [1.1, 1.1],
];

/**
 * Ninja Horizon-styled outlined comic/anime combat text & status pills:
 *  - Damage / Crit / Heal / CP / Dodge: thick crisp black outline via `strokeCopy` layers
 *  - Buff / Debuff: sleek dark-glass rounded status pill with glowing emerald / crimson border
 *  - 100% Native GPU (`useNativeDriver: true` + `renderToHardwareTextureAndroid`)
 */
export const FloatingPopup = React.memo(function FloatingPopup({
  item,
  index,
  speedMultiplier = 1,
  onDone,
}: FloatingPopupProps) {
  const translateY = useRef(new Animated.Value(8)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const dur = speedMultiplier > 1 ? 660 : 940;
    const popDur = speedMultiplier > 1 ? 115 : 155;
    const peakScale = item.kind === 'crit' ? 1.28 : item.kind === 'buff' || item.kind === 'debuff' ? 1.06 : 1.12;

    Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, {
          toValue: peakScale,
          duration: popDur,
          easing: Easing.out(Easing.back(2.2)),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: item.kind === 'crit' ? 1.04 : 1.0,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(translateY, {
        toValue: -52 - index * 8,
        duration: dur,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 75,
          useNativeDriver: true,
        }),
        Animated.delay(Math.max(220, dur - 300)),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 210,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      onDone?.(item.id);
    });
  }, [item.id, item.kind, index, speedMultiplier, onDone, opacity, scale, translateY]);

  const isStatusPill = item.kind === 'buff' || item.kind === 'debuff';
  const isCrit = item.kind === 'crit';

  // Split "CRIT -123!" so CRIT sits as a sharp Ninja Horizon mini-banner above the huge gold number
  const cleanCritVal = isCrit
    ? item.text.replace(/^CRIT\s*/i, '').trim() || item.text
    : item.text;

  const textStyle = [
    styles.numText,
    item.kind === 'damage' && styles.damageColor,
    item.kind === 'crit' && styles.critText,
    item.kind === 'cp' && styles.cpText,
    item.kind === 'dodge' && styles.dodgeText,
    item.kind === 'heal' && styles.healText,
  ];

  const strokeColor =
    item.kind === 'crit'
      ? '#2E1000'
      : item.kind === 'heal'
      ? '#052E16'
      : item.kind === 'cp'
      ? '#082F49'
      : '#09090B';

  return (
    <Animated.View
      pointerEvents="none"
      renderToHardwareTextureAndroid
      style={[
        styles.wrap,
        {
          marginTop: index * 3,
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      {isStatusPill ? (
        <View
          style={[
            styles.statusPill,
            item.kind === 'buff' ? styles.buffPill : styles.debuffPill,
          ]}
        >
          <View
            style={[
              styles.statusDot,
              item.kind === 'buff' ? styles.buffDot : styles.debuffDot,
            ]}
          />
          <Text
            style={[
              styles.statusPillText,
              item.kind === 'buff' ? styles.buffText : styles.debuffText,
            ]}
            numberOfLines={1}
          >
            {item.text}
          </Text>
        </View>
      ) : (
        <View style={styles.numWrap}>
          {isCrit && (
            <View style={styles.critHeaderPill}>
              <Text style={styles.critHeaderText}>⚡ CRITICAL</Text>
            </View>
          )}
          <View style={styles.strokeContainer}>
            {STROKE_OFFSETS.map(([dx, dy], i) => (
              <Text
                key={i}
                style={[
                  textStyle,
                  styles.strokeCopy,
                  {
                    color: strokeColor,
                    transform: [{ translateX: dx }, { translateY: dy }],
                  },
                ]}
              >
                {cleanCritVal}
              </Text>
            ))}
            <Text style={textStyle}>{cleanCritVal}</Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  numWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  strokeContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  strokeCopy: {
    position: 'absolute',
    textShadowColor: 'transparent',
  },
  numText: {
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 0.6,
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  damageColor: {
    color: '#FF453A',
  },
  critHeaderPill: {
    backgroundColor: 'rgba(180, 83, 9, 0.94)',
    borderWidth: 1,
    borderColor: '#FEF08A',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginBottom: -2,
    shadowColor: '#FACC15',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 4,
    elevation: 4,
  },
  critHeaderText: {
    color: '#FEF9C3',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  critText: {
    color: '#FDE047',
    fontSize: 29,
    letterSpacing: 0.8,
  },
  cpText: {
    color: '#38BDF8',
    fontSize: 18,
  },
  dodgeText: {
    color: '#BEF264',
    fontSize: 21,
    letterSpacing: 1.1,
  },
  healText: {
    color: '#4ADE80',
    fontSize: 20,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 10,
    borderWidth: 1.25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.75,
    shadowRadius: 4,
    elevation: 5,
  },
  buffPill: {
    backgroundColor: 'rgba(6, 78, 59, 0.92)',
    borderColor: '#34D399',
  },
  debuffPill: {
    backgroundColor: 'rgba(107, 17, 47, 0.92)',
    borderColor: '#FB7185',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  buffDot: {
    backgroundColor: '#6EE7B7',
  },
  debuffDot: {
    backgroundColor: '#FDA4AF',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  buffText: {
    color: '#D1FAE5',
  },
  debuffText: {
    color: '#FFE4E6',
  },
});
