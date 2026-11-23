import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { playBgm, playClickSfx } from '../audio/audioManager';
import { buildAudioUrl, buildPlayerSwfUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore, type ScreenName } from '../store/useAuthStore';

const VILLAGE_MAP_BG = require('../../assets/village_hub_bg.jpg');
const MAP_IMG_W = 1376;
const MAP_IMG_H = 768;

const ELEMENT_META: Record<number, { label: string; icon: string; color: string }> = {
  1: { label: 'Wind', icon: '🌪️', color: '#15803D' },
  2: { label: 'Fire', icon: '🔥', color: '#B91C1C' },
  3: { label: 'Lightning', icon: '⚡', color: '#A16207' },
  4: { label: 'Earth', icon: '🪨', color: '#78350F' },
  5: { label: 'Water', icon: '💧', color: '#1D4ED8' },
};

const VILLAGE_LANDMARKS: Array<{
  screen: ScreenName;
  icon: string;
  label: string;
  accent: string;
  nx: number;
  ny: number;
}> = [
  { screen: 'missions', icon: '🏛️', label: 'Mission Room', accent: '#EA580C', nx: 0.09, ny: 0.63 },
  { screen: 'academy', icon: '📜', label: 'Academy', accent: '#F59E0B', nx: 0.52, ny: 0.32 },
  { screen: 'pvp', icon: '🥊', label: 'PvP Arena', accent: '#DC2626', nx: 0.75, ny: 0.33 },
  { screen: 'talent', icon: '✨', label: 'Talent Hall', accent: '#A855F7', nx: 0.91, ny: 0.37 },
  { screen: 'forge', icon: '⚒️', label: 'Blacksmith', accent: '#D97706', nx: 0.30, ny: 0.56 },
  { screen: 'inventory', icon: '🛍️', label: 'Ninja Shop', accent: '#0EA5E9', nx: 0.61, ny: 0.61 },
  { screen: 'petShop', icon: '🐾', label: 'Pet Shop', accent: '#10B981', nx: 0.75, ny: 0.78 },
  { screen: 'hunting', icon: '🏹', label: 'Hunting', accent: '#EF4444', nx: 0.90, ny: 0.75 },
];

export function VillageHubScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);
  const win = useWindowDimensions();
  const [size, setSize] = useState({ width: win.width, height: win.height });

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const accountType = useAuthStore((s) => s.accountType);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);
  const logout = useAuthStore((s) => s.logout);
  const isPremium = accountType >= 1;

  const [bridgeReady, setBridgeReady] = useState(false);

  const equipTag = profile
    ? `${profile.hairStyle}_${profile.hairColor}_${profile.clothing}_${profile.weapon}_${profile.back}`
    : '';

  useEffect(() => {
    playBgm(buildAudioUrl(serverUrl, 'bgm.mp3'));
  }, [serverUrl]);

  useEffect(() => {
    if (!profile || !bridgeReady) return;
    const url = buildPlayerSwfUrl(serverUrl, profile.charId, 'standby', equipTag, { portrait: true });
    stageRef.current?.loadSwf(url);
  }, [serverUrl, profile, equipTag, bridgeReady]);

  const handleStageEvent = useCallback((ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') {
      setBridgeReady(true);
    }
  }, []);

  if (!profile) {
    return null;
  }

  const elem = ELEMENT_META[profile.element1] ?? ELEMENT_META[3];
  const xpSpan = Math.max(1, profile.nextLevelXp - profile.prevLevelXp);
  const xpIntoLevel = Math.max(0, profile.xp - profile.prevLevelXp);
  const xpBarPct = `${Math.min(100, Math.max(0, Math.round((xpIntoLevel / xpSpan) * 100)))}%`;

  const mapScale = Math.max(size.width / MAP_IMG_W, size.height / MAP_IMG_H);
  const mapOffX = (size.width - MAP_IMG_W * mapScale) / 2;
  const mapOffY = (size.height - MAP_IMG_H * mapScale) / 2;

  const go = (screen: ScreenName) => {
    playClickSfx(serverUrl);
    navigate(screen);
  };

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) {
          setSize((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height }
          );
        }
      }}
    >
      {/* 1) INSTANT 0ms FULL-SCREEN INTERACTIVE NINJA VILLAGE MAP */}
      <Image source={VILLAGE_MAP_BG} style={styles.fullVillageBg} resizeMode="cover" />

      {/* 2) INTERACTIVE CLICKABLE VILLAGE BUILDINGS */}
      <View style={styles.landmarksLayer} pointerEvents="box-none">
        {VILLAGE_LANDMARKS.map((b) => {
          const px = mapOffX + b.nx * MAP_IMG_W * mapScale;
          const py = mapOffY + b.ny * MAP_IMG_H * mapScale;
          return (
            <Pressable
              key={b.screen}
              style={[
                styles.buildingHotspot,
                {
                  left: Math.max(8, Math.min(size.width - 108, px - 52)),
                  top: Math.max(64, Math.min(size.height - 96, py - 24)),
                },
              ]}
              onPress={() => go(b.screen)}
            >
              <View style={[styles.signPlaque, { borderColor: b.accent }]}>
                <Text style={styles.signIcon}>{b.icon}</Text>
                <Text style={styles.signLabel} numberOfLines={1}>
                  {b.label}
                </Text>
              </View>
              <View style={[styles.signPinStem, { backgroundColor: b.accent }]} />
            </Pressable>
          );
        })}
      </View>

      {/* 3) AUTHENTIC NINJA SAGA TOP HUD */}
      <View style={styles.topHud} pointerEvents="box-none">
        <View style={styles.charBanner}>
          <View style={styles.portraitWrap}>
            <View style={styles.portraitFrame} pointerEvents="none">
              <RuffleStageView ref={stageRef} baseUrl={serverUrl} onEvent={handleStageEvent} />
            </View>
            <View style={[styles.elemMiniBadge, { backgroundColor: elem.color }]}>
              <Text style={styles.elemMiniTxt}>{elem.icon}</Text>
            </View>
          </View>
          <View style={styles.charMetaCol}>
            <View style={styles.nameRow}>
              <Text style={styles.charName}>{profile.name}</Text>
              <View style={styles.lvPill}>
                <Text style={styles.lvTxt}>Lv.{profile.level}</Text>
              </View>
              <View style={[styles.tierPill, isPremium && styles.tierPillPrem]}>
                <Text style={[styles.tierPillTxt, isPremium && styles.tierPillTxtPrem]}>
                  {isPremium ? '★ PREMIUM' : 'FREE'}
                </Text>
              </View>
            </View>
            <View style={styles.xpBarBg}>
              <View style={[styles.xpBarFill, { width: xpBarPct as `${number}%` }]} />
              <Text style={styles.xpBarLabel}>
                EXP {profile.xp.toLocaleString()} / {profile.nextLevelXp.toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.currencyRow}>
          <View style={styles.currencyPill}>
            <Text style={styles.goldIcon}>🪙</Text>
            <Text style={styles.goldVal}>{profile.gold.toLocaleString()}</Text>
          </View>
          <View style={[styles.currencyPill, styles.tokenPill]}>
            <Text style={styles.goldIcon}>💎</Text>
            <Text style={styles.tokenVal}>{profile.tokens.toLocaleString()}</Text>
          </View>
          <Pressable style={styles.sysBtn} onPress={() => go('charSelect')}>
            <Text style={styles.sysBtnTxt}>Switch</Text>
          </Pressable>
          <Pressable
            style={[styles.sysBtn, styles.logoutBtn]}
            onPress={() => {
              playClickSfx(serverUrl);
              logout();
            }}
          >
            <Text style={styles.sysBtnTxt}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {/* 4) BOTTOM NINJA SAGA QUICK-SCROLL DOCK */}
      <View style={styles.bottomDockWrap} pointerEvents="box-none">
        <View style={styles.bottomDock}>
          <Pressable style={styles.dockBtn} onPress={() => go('myJutsu')}>
            <Text style={styles.dockIcon}>📜</Text>
            <Text style={styles.dockLabel}>My Jutsu ({profile.equippedSkills.length}/6)</Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable style={styles.dockBtn} onPress={() => go('stats')}>
            <Text style={styles.dockIcon}>⚡</Text>
            <Text style={styles.dockLabel}>
              Stats{profile.points.free > 0 ? ` (+${profile.points.free})` : ''}
            </Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable style={styles.dockBtn} onPress={() => go('bag')}>
            <Text style={styles.dockIcon}>🎒</Text>
            <Text style={styles.dockLabel}>Inventory</Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable style={styles.dockBtn} onPress={() => go('pet')}>
            <Text style={styles.dockIcon}>🐾</Text>
            <Text style={styles.dockLabel}>Pet</Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable style={styles.dockBtn} onPress={() => go('chat')}>
            <Text style={styles.dockIcon}>💬</Text>
            <Text style={styles.dockLabel}>Chat</Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable style={[styles.dockBtn, styles.dockMissionBtn]} onPress={() => go('missions')}>
            <Text style={styles.dockIcon}>⚔️</Text>
            <Text style={styles.dockLabel}>Mission</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#132117',
    position: 'relative',
    overflow: 'hidden',
  },
  fullVillageBg: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  landmarksLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 14,
  },
  buildingHotspot: {
    position: 'absolute',
    width: 104,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signPlaque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(15, 20, 32, 0.88)',
    borderRadius: 9,
    borderWidth: 1.5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 6,
  },
  signIcon: {
    fontSize: 12,
  },
  signLabel: {
    color: '#F8FAFC',
    fontSize: 10,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  signPinStem: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 2,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  topHud: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  charBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(8, 12, 22, 0.86)',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#C8A24A',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  portraitWrap: {
    width: 56,
    height: 56,
    position: 'relative',
    backgroundColor: '#F3DBA6',
    borderWidth: 2,
    borderColor: '#D4AF37',
    padding: 1,
  },
  portraitFrame: {
    flex: 1,
    backgroundColor: '#EAD098',
  },
  elemMiniBadge: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#FDE047',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  elemMiniTxt: {
    fontSize: 10,
  },
  charMetaCol: {
    minWidth: 170,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  charName: {
    color: '#F8FAFC',
    fontSize: 13.5,
    fontWeight: '900',
  },
  lvPill: {
    backgroundColor: '#EA580C',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  lvTxt: {
    color: '#FFF',
    fontSize: 9.5,
    fontWeight: '900',
  },
  tierPill: {
    backgroundColor: '#334155',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  tierPillPrem: {
    backgroundColor: '#78350F',
    borderWidth: 0.75,
    borderColor: '#FDE047',
  },
  tierPillTxt: {
    color: '#CBD5E1',
    fontSize: 8,
    fontWeight: '900',
  },
  tierPillTxtPrem: {
    color: '#FEF08A',
  },
  xpBarBg: {
    height: 12,
    backgroundColor: '#1E293B',
    borderRadius: 5,
    borderWidth: 0.75,
    borderColor: '#475569',
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  xpBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#22C55E',
  },
  xpBarLabel: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(8, 12, 22, 0.86)',
    borderRadius: 9,
    borderWidth: 1.25,
    borderColor: '#C8A24A',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  tokenPill: {
    borderColor: '#38BDF8',
  },
  goldIcon: {
    fontSize: 11,
  },
  goldVal: {
    color: '#FACC15',
    fontSize: 11,
    fontWeight: '900',
  },
  tokenVal: {
    color: '#7DD3FC',
    fontSize: 11,
    fontWeight: '900',
  },
  sysBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  logoutBtn: {
    backgroundColor: 'rgba(127, 29, 29, 0.9)',
    borderColor: '#F87171',
  },
  sysBtnTxt: {
    color: '#F8FAFC',
    fontSize: 10.5,
    fontWeight: '800',
  },
  bottomDockWrap: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  bottomDock: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 12, 22, 0.88)',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#C8A24A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  dockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  dockMissionBtn: {
    backgroundColor: '#EA580C',
  },
  dockIcon: {
    fontSize: 13,
  },
  dockLabel: {
    color: '#F8FAFC',
    fontSize: 10.5,
    fontWeight: '900',
  },
  dockSep: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(200, 162, 74, 0.35)',
  },
});
