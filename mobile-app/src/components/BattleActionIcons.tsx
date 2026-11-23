import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SkillDef } from '../api/gameData';
import { getSkillElementMeta, isSkillAoE } from '../engine/battleEngine';

/**
 * Ninja Horizon-styled square beveled action icons built with crisp vector-like View geometry.
 */

function KunaiIcon() {
  return (
    <View style={iconStyles.box}>
      {/* Diagonal glowing slash arc */}
      <View style={iconStyles.slashArc} />
      {/* Kunai blade */}
      <View style={iconStyles.kunaiWrap}>
        <View style={iconStyles.kunaiTip} />
        <View style={iconStyles.kunaiBlade} />
        <View style={iconStyles.kunaiGuard} />
        <View style={iconStyles.kunaiHandle} />
        <View style={iconStyles.kunaiRing} />
      </View>
    </View>
  );
}

function ChakraOrbIcon() {
  return (
    <View style={iconStyles.box}>
      <View style={iconStyles.orbOuter}>
        <View style={iconStyles.orbMid}>
          <View style={iconStyles.orbCore} />
        </View>
      </View>
      <View style={[iconStyles.spark, { top: 4, left: 6 }]} />
      <View style={[iconStyles.spark, { bottom: 5, right: 5 }]} />
      <View style={[iconStyles.sparkSm, { top: 6, right: 7 }]} />
    </View>
  );
}

function JutsuCrestIcon({ type }: { type?: string }) {
  const meta = getSkillElementMeta(type);
  const t = String(type ?? '');

  // Crisp elemental medallion crest matching Ninja Horizon's jutsu tiles
  return (
    <View style={[iconStyles.crestOuter, { borderColor: meta.border }]}>
      <View style={[iconStyles.crestInner, { backgroundColor: `${meta.border}26` }]}>
        {t === '1' ? (
          // Wind: swirling rings
          <View style={iconStyles.windSwirl}>
            <View style={iconStyles.windCore} />
          </View>
        ) : t === '2' ? (
          // Fire: blazing flame core
          <View style={iconStyles.fireOuter}>
            <View style={iconStyles.fireInner} />
          </View>
        ) : t === '3' ? (
          // Lightning: electric diamond spark
          <View style={iconStyles.boltWrap}>
            <View style={iconStyles.boltTop} />
            <View style={iconStyles.boltBot} />
          </View>
        ) : t === '4' ? (
          // Earth: solid diamond monolith
          <View style={iconStyles.earthDiamond} />
        ) : t === '5' ? (
          // Water: wave drop
          <View style={iconStyles.waterDrop}>
            <View style={iconStyles.waterHighlight} />
          </View>
        ) : (
          // Taijutsu / Genjutsu / Kinjutsu: ninja star crest
          <Text style={iconStyles.fallbackGlyph}>{meta.icon}</Text>
        )}
      </View>
    </View>
  );
}

interface ActionTileProps {
  disabled?: boolean;
  onPress: () => void;
}

export function AttackActionTile({ disabled, onPress }: ActionTileProps) {
  return (
    <Pressable
      style={[tileStyles.base, tileStyles.attackFrame, disabled && tileStyles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <View style={tileStyles.topShine} />
      <KunaiIcon />
      <Text style={tileStyles.label}>ATTACK</Text>
      <View style={tileStyles.cpPillGreen}>
        <Text style={tileStyles.cpPillText}>+5%</Text>
      </View>
    </Pressable>
  );
}

export function ChargeActionTile({
  disabled,
  locked,
  onPress,
}: ActionTileProps & { locked?: boolean }) {
  return (
    <Pressable
      style={[tileStyles.base, tileStyles.chargeFrame, disabled && tileStyles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <View style={tileStyles.topShine} />
      <ChakraOrbIcon />
      <Text style={tileStyles.label}>{locked ? 'LOCKED' : 'CHARGE'}</Text>
      <View style={tileStyles.cpPillBlue}>
        <Text style={tileStyles.cpPillText}>+25%</Text>
      </View>
    </Pressable>
  );
}

interface JutsuActionTileProps {
  skill: SkillDef;
  iconUri?: string;
  cpCost: number;
  cooldown: number;
  disabled?: boolean;
  sealed?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export function JutsuActionTile({
  skill,
  iconUri,
  cpCost,
  cooldown,
  disabled,
  sealed,
  onPress,
  onLongPress,
}: JutsuActionTileProps) {
  const elem = getSkillElementMeta(skill.type);
  const aoe = isSkillAoE(skill);

  return (
    <Pressable
      delayLongPress={230}
      style={[
        tileStyles.jutsuBase,
        { backgroundColor: elem.bg, borderColor: elem.border },
        disabled && tileStyles.disabled,
      ]}
      onPress={() => {
        if (!disabled) onPress();
      }}
      onLongPress={onLongPress}
    >
      <View style={tileStyles.topShine} />
      {iconUri ? (
        <Image source={{ uri: iconUri }} style={tileStyles.realJutsuIcon} resizeMode="cover" />
      ) : (
        <JutsuCrestIcon type={skill.type} />
      )}

      {/* AoE indicator */}
      {aoe && (
        <View style={tileStyles.aoePill}>
          <Text style={tileStyles.aoeText}>ALL</Text>
        </View>
      )}

      {/* CP cost pill */}
      <View style={tileStyles.cpBadge}>
        <Text style={tileStyles.cpBadgeText}>{cpCost}</Text>
      </View>

      {/* Cooldown / Sealed overlay */}
      {(cooldown > 0 || sealed) && (
        <View style={tileStyles.cdOverlay}>
          <Text style={tileStyles.cdNumber}>{sealed ? '🔒' : cooldown}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function ItemActionTile({
  count,
  disabled,
  active,
  onPress,
}: ActionTileProps & { count: number; active?: boolean }) {
  return (
    <Pressable
      style={[
        tileStyles.smallBase,
        tileStyles.itemFrame,
        active && tileStyles.itemFrameActive,
        disabled && tileStyles.disabled,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <View style={tileStyles.topShine} />
      <Text style={tileStyles.smallEmoji}>📜</Text>
      <Text style={tileStyles.smallLabel}>ITEM</Text>
      <View style={tileStyles.countBadge}>
        <Text style={tileStyles.countBadgeText}>{count}</Text>
      </View>
    </Pressable>
  );
}

export function FleeActionTile({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={[tileStyles.smallBase, tileStyles.fleeFrame]} onPress={onPress}>
      <View style={tileStyles.topShine} />
      <Text style={tileStyles.smallEmoji}>💨</Text>
      <Text style={tileStyles.smallLabel}>FLEE</Text>
    </Pressable>
  );
}

const tileStyles = StyleSheet.create({
  base: {
    width: 56,
    height: 56,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
    elevation: 5,
  },
  attackFrame: {
    backgroundColor: '#7F1D1D',
    borderColor: '#F87171',
  },
  chargeFrame: {
    backgroundColor: '#0C4A6E',
    borderColor: '#38BDF8',
  },
  jutsuBase: {
    width: 56,
    height: 56,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
    elevation: 5,
  },
  smallBase: {
    width: 46,
    height: 56,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  itemFrame: {
    backgroundColor: '#115E59',
    borderColor: '#2DD4BF',
  },
  itemFrameActive: {
    borderColor: '#FACC15',
    backgroundColor: '#0F766E',
  },
  fleeFrame: {
    backgroundColor: '#1E293B',
    borderColor: '#94A3B8',
  },
  disabled: {
    opacity: 0.42,
  },
  topShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '42%',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginTop: 2,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  jutsuName: {
    color: '#FFFFFF',
    fontSize: 7.5,
    fontWeight: '800',
    marginTop: 1,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  realJutsuIcon: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  cpPillGreen: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(22, 163, 74, 0.9)',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 0.5,
  },
  cpPillBlue: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(2, 132, 199, 0.92)',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 0.5,
  },
  cpPillText: {
    color: '#FFF',
    fontSize: 7,
    fontWeight: '900',
  },
  aoePill: {
    position: 'absolute',
    top: 2,
    left: 2,
    backgroundColor: '#D97706',
    borderRadius: 3,
    paddingHorizontal: 2.5,
    paddingVertical: 0.5,
  },
  aoeText: {
    color: '#FFF',
    fontSize: 6.5,
    fontWeight: '900',
  },
  cpBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    borderRadius: 4,
    borderWidth: 0.75,
    borderColor: '#38BDF8',
    paddingHorizontal: 3,
    paddingVertical: 0.5,
  },
  cpBadgeText: {
    color: '#7DD3FC',
    fontSize: 7.5,
    fontWeight: '900',
  },
  cdOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.74)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cdNumber: {
    color: '#FACC15',
    fontSize: 18,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  smallEmoji: {
    fontSize: 18,
  },
  smallLabel: {
    color: '#F8FAFC',
    fontSize: 7.5,
    fontWeight: '900',
    marginTop: 2,
  },
  countBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#0F172A',
    borderRadius: 6,
    borderWidth: 0.75,
    borderColor: '#2DD4BF',
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  countBadgeText: {
    color: '#99F6E4',
    fontSize: 8,
    fontWeight: '900',
  },
});

const iconStyles = StyleSheet.create({
  box: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  slashArc: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: 'rgba(254, 202, 202, 0.65)',
    transform: [{ rotate: '15deg' }],
  },
  kunaiWrap: {
    alignItems: 'center',
    transform: [{ rotate: '45deg' }],
  },
  kunaiTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 4.5,
    borderRightWidth: 4.5,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#F8FAFC',
  },
  kunaiBlade: {
    width: 8,
    height: 7,
    backgroundColor: '#CBD5E1',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  kunaiGuard: {
    width: 10,
    height: 2,
    backgroundColor: '#F59E0B',
  },
  kunaiHandle: {
    width: 3,
    height: 6,
    backgroundColor: '#991B1B',
  },
  kunaiRing: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  orbOuter: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: '#7DD3FC',
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbMid: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbCore: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#F0F9FF',
  },
  spark: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#BAE6FD',
  },
  sparkSm: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#E0F2FE',
  },
  crestOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.35)',
  },
  crestInner: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  windSwirl: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#86EFAC',
    borderRightColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  windCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DCFCE7',
  },
  fireOuter: {
    width: 12,
    height: 14,
    borderRadius: 7,
    borderTopLeftRadius: 2,
    backgroundColor: '#FB923C',
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  fireInner: {
    width: 6,
    height: 7,
    borderRadius: 3,
    backgroundColor: '#FEF08A',
  },
  boltWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  boltTop: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 2,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FEF08A',
    transform: [{ translateX: -1 }],
  },
  boltBot: {
    width: 0,
    height: 0,
    borderLeftWidth: 2,
    borderRightWidth: 4,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FACC15',
    transform: [{ translateX: 1 }, { translateY: -2 }],
  },
  earthDiamond: {
    width: 11,
    height: 11,
    backgroundColor: '#F59E0B',
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    transform: [{ rotate: '45deg' }],
  },
  waterDrop: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderTopLeftRadius: 1,
    backgroundColor: '#60A5FA',
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  waterHighlight: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DBEAFE',
  },
  fallbackGlyph: {
    fontSize: 13,
  },
});
