import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  isBgmMuted,
  isSfxMuted,
  playBgm,
  playClickSfx,
  setBgmMuted,
  setSfxMuted,
} from '../audio/audioManager';
import { buildAudioUrl, buildPlayerSwfUrl } from '../config/env';
import { buildPlayerCombatant } from '../engine/battleEngine';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore, type ScreenName } from '../store/useAuthStore';

const VILLAGE_MAP_BG = require('../../assets/village_hub_bg.jpg');
const MAP_IMG_W = 1376;
const MAP_IMG_H = 768;

const RANK_GRADES: Record<number, string> = {
  1: 'Genin',
  2: 'Genin',
  3: 'Chunin',
  4: 'Chunin',
  5: 'Jounin',
  6: 'Jounin',
  7: 'Special Jounin',
  8: 'Ninja Tutor',
  9: 'Senior Tutor',
  10: 'Sage',
};

const VILLAGE_LANDMARKS: Array<{
  screen: ScreenName;
  icon: string;
  label: string;
  subtitle: string;
  category: 'combat' | 'village';
  accent: string;
  nx: number;
  ny: number;
  minRank?: number;
  reqRankLabel?: string;
  inDevelopment?: boolean;
}> = [
  // Upper Row (5 buildings neatly aligned horizontally)
  { screen: 'headquarter', icon: '🏯', label: 'Headquarter', subtitle: 'Rank Exams', category: 'combat', accent: '#F59E0B', nx: 0.11, ny: 0.44 },
  { screen: 'academy', icon: '📜', label: 'Academy', subtitle: 'Learn Jutsu', category: 'village', accent: '#EAB308', nx: 0.32, ny: 0.44 },
  { screen: 'pvp', icon: '🥊', label: 'PvP Arena', subtitle: 'Live Duels', category: 'combat', accent: '#EF4444', nx: 0.52, ny: 0.44, inDevelopment: true },
  { screen: 'talent', icon: '✨', label: 'Talent Hall', subtitle: 'Bloodlines', category: 'village', accent: '#A855F7', nx: 0.70, ny: 0.44, minRank: 5, reqRankLabel: 'Jounin' },
  { screen: 'senjutsu', icon: '☯️', label: 'Senjutsu', subtitle: 'Sage Mode', category: 'combat', accent: '#14B8A6', nx: 0.89, ny: 0.44, minRank: 10, reqRankLabel: 'Sage' },
  // Lower Row (5 buildings neatly aligned horizontally)
  { screen: 'missions', icon: '🏛️', label: 'Mission Room', subtitle: 'Grade C–S & TP', category: 'combat', accent: '#F97316', nx: 0.11, ny: 0.77 },
  { screen: 'forge', icon: '⚒️', label: 'Blacksmith', subtitle: 'Forge Weapons', category: 'village', accent: '#D97706', nx: 0.31, ny: 0.77 },
  { screen: 'inventory', icon: '🛍️', label: 'Shop', subtitle: 'Gear & Items', category: 'village', accent: '#38BDF8', nx: 0.51, ny: 0.77 },
  { screen: 'petShop', icon: '🐾', label: 'Pet Shop', subtitle: 'Shop & Villa', category: 'village', accent: '#10B981', nx: 0.70, ny: 0.77, minRank: 3, reqRankLabel: 'Chunin' },
  { screen: 'hunting', icon: '🏹', label: 'Hunting', subtitle: 'Boss & Market', category: 'combat', accent: '#FB7185', nx: 0.90, ny: 0.77 },
];

let cachedHubSize: { width: number; height: number } | null = null;

export function VillageHubScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);
  const win = useWindowDimensions();
  const [size, setSize] = useState(() =>
    cachedHubSize ?? {
      width: Math.max(win.width, win.height),
      height: Math.min(win.width, win.height),
    }
  );

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const accountType = useAuthStore((s) => s.accountType);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);
  const logout = useAuthStore((s) => s.logout);
  const graphicsQuality = useAuthStore((s) => s.graphicsQuality);
  const setGraphicsQuality = useAuthStore((s) => s.setGraphicsQuality);
  const recruitedTeam = useAuthStore((s) => s.recruitedTeam);
  const isPremium = accountType >= 1;

  const [bridgeReady, setBridgeReady] = useState(false);
  const [optionOpen, setOptionOpen] = useState(false);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const [bgmOff, setBgmOff] = useState(() => isBgmMuted());
  const [sfxOff, setSfxOff] = useState(() => isSfxMuted());

  useEffect(() => {
    if (!lockNotice) return;
    const t = setTimeout(() => setLockNotice(null), 2000);
    return () => clearTimeout(t);
  }, [lockNotice]);

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

  const xpSpan = Math.max(1, profile.nextLevelXp - profile.prevLevelXp);
  const xpIntoLevel = Math.max(0, profile.xp - profile.prevLevelXp);
  const xpBarPct = `${Math.min(100, Math.max(0, Math.round((xpIntoLevel / xpSpan) * 100)))}%`;
  const hudStats = buildPlayerCombatant(profile.name, profile.level, profile.points, 0);

  const MAP_SHIFT_Y = -50;
  const mapScale = Math.max(size.width / MAP_IMG_W, size.height / MAP_IMG_H);
  const mapW = MAP_IMG_W * mapScale;
  const mapH = MAP_IMG_H * mapScale;
  const mapOffX = (size.width - mapW) / 2;
  const mapOffY = (size.height - mapH) / 2 + MAP_SHIFT_Y;

  const gradeLabel = RANK_GRADES[profile.rank] ?? (profile.rank >= 10 ? 'Sage' : 'Genin');

  const go = (screen: ScreenName) => {
    playClickSfx(serverUrl);
    if (screen === 'pvp') {
      setLockNotice('🔒 Arena in development');
      return;
    }
    if (screen === 'petShop' && profile.rank < 3) {
      setLockNotice('🔒 Pet Shop requires Chunin rank!');
      return;
    }
    if (screen === 'talent' && profile.rank < 5) {
      setLockNotice('🔒 Talent Hall requires Jounin rank!');
      return;
    }
    if (screen === 'senjutsu' && profile.rank < 10 && !profile.senjutsuType) {
      setLockNotice('🔒 Senjutsu requires Sage rank!');
      return;
    }
    navigate(screen);
  };

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) {
          cachedHubSize = { width, height };
          setSize((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height }
          );
        }
      }}
    >
      {/* 1) INSTANT 0ms FULL-SCREEN INTERACTIVE NINJA VILLAGE MAP (SHIFTED 50PX UP) */}
      <Image
        source={VILLAGE_MAP_BG}
        style={{
          position: 'absolute',
          left: mapOffX,
          top: mapOffY,
          width: mapW,
          height: mapH,
        }}
        resizeMode="cover"
      />

      {/* 2) INTERACTIVE CLICKABLE VILLAGE BUILDINGS */}
      <View style={styles.landmarksLayer} pointerEvents="box-none">
        {VILLAGE_LANDMARKS.map((b) => {
          const px = mapOffX + b.nx * MAP_IMG_W * mapScale;
          const py = mapOffY + b.ny * MAP_IMG_H * mapScale;
          const isLocked = Boolean(
            b.inDevelopment ||
              (b.minRank &&
                profile.rank < b.minRank &&
                !(b.screen === 'senjutsu' && profile.senjutsuType))
          );
          return (
            <Pressable
              key={b.screen}
              style={[
                styles.buildingHotspot,
                {
                  left: Math.max(6, Math.min(size.width - 102, px - 48)),
                  top: Math.max(68, Math.min(size.height - 86, py - 18)),
                },
              ]}
              onPress={() => go(b.screen)}
            >
              <View style={[styles.signPlaque, isLocked && styles.signPlaqueLocked]}>
                <View style={[styles.signAccentDot, { backgroundColor: isLocked ? '#94A3B8' : b.accent }]} />
                <Text style={styles.signIcon}>{isLocked ? '🔒' : b.icon}</Text>
                <Text style={styles.signLabel} numberOfLines={1}>
                  {b.label}
                </Text>
              </View>
              <View style={[styles.signPinStem, { backgroundColor: isLocked ? '#94A3B8' : b.accent }]} />
            </Pressable>
          );
        })}
      </View>

      {lockNotice ? (
        <View style={styles.lockToast} pointerEvents="none">
          <Text style={styles.lockToastTxt}>{lockNotice}</Text>
        </View>
      ) : null}

      {/* 3) AUTHENTIC NINJA SAGA TOP HUD */}
      <View style={styles.topHud} pointerEvents="box-none">
        <View style={styles.topLeftRow}>
          <View style={styles.charBanner}>
          <View style={styles.portraitWrap}>
            <View style={styles.portraitFrame} pointerEvents="none">
              <RuffleStageView ref={stageRef} baseUrl={serverUrl} onEvent={handleStageEvent} />
            </View>
          </View>
          <View style={styles.charMetaCol}>
            <View style={styles.nameRow}>
              <Text style={styles.charName}>{profile.name}</Text>
              <View style={styles.lvPill}>
                <Text style={styles.lvTxt}>Lv.{profile.level}</Text>
              </View>
              <View style={[styles.tierPill, styles.tierPillPrem]}>
                <Text style={[styles.tierPillTxt, styles.tierPillTxtPrem]}>
                  {gradeLabel.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.vitalBarBg}>
              <View style={[styles.vitalBarFill, styles.hpBarFill]} />
              <Text style={styles.vitalBarLabel}>
                HP {hudStats.maxHp.toLocaleString()} / {hudStats.maxHp.toLocaleString()}
              </Text>
            </View>
            <View style={styles.vitalBarBg}>
              <View style={[styles.vitalBarFill, styles.cpBarFill]} />
              <Text style={styles.vitalBarLabel}>
                CP {hudStats.maxCp.toLocaleString()} / {hudStats.maxCp.toLocaleString()}
              </Text>
            </View>
            <View style={styles.xpBarBg}>
              <View style={[styles.xpBarFill, { width: xpBarPct as `${number}%` }]} />
              <Text style={styles.xpBarLabel}>
                EXP {profile.xp.toLocaleString()} / {profile.nextLevelXp.toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

          <Pressable style={styles.teamHudBtn} onPress={() => go('recruit')}>
            <Text style={styles.teamHudIcon}>👥</Text>
            <Text style={styles.teamHudCount}>{recruitedTeam.length}/2</Text>
            <Text style={styles.teamHudLabel}>Team</Text>
          </Pressable>
        </View>

        <View style={styles.topRightCol}>
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
      </View>

      {/* 4) FLOATING CHAT, RECRUIT, BOOK, DAILY & SOCIAL ICONS (BOTTOM-LEFT CORNER) */}
      <View style={styles.bottomLeftFloatRow} pointerEvents="box-none">
        <Pressable style={styles.chatFloatingBtn} onPress={() => go('chat')}>
          <Text style={styles.chatFloatingIcon}>💬</Text>
          <Text style={styles.chatFloatingLabel}>Chat</Text>
        </Pressable>
        <Pressable style={styles.recruitFloatingBtn} onPress={() => go('recruit')}>
          <Text style={styles.chatFloatingIcon}>🤝</Text>
          <Text style={styles.chatFloatingLabel}>Recruit</Text>
        </Pressable>
        <Pressable style={styles.bookFloatingBtn} onPress={() => go('encyclopedia')}>
          <Text style={styles.chatFloatingIcon}>📖</Text>
          <Text style={styles.chatFloatingLabel}>Book</Text>
        </Pressable>
        <Pressable style={styles.dailyFloatingBtn} onPress={() => go('daily')}>
          <Text style={styles.chatFloatingIcon}>🎁</Text>
          <Text style={styles.chatFloatingLabel}>Daily</Text>
        </Pressable>
        <Pressable style={styles.socialFloatingBtn} onPress={() => go('social')}>
          <Text style={styles.chatFloatingIcon}>📬</Text>
          <Text style={styles.chatFloatingLabel}>Social</Text>
        </Pressable>
      </View>

      {/* 5) BOTTOM NINJA SAGA QUICK-SCROLL DOCK */}
      <View style={styles.bottomDockWrap} pointerEvents="box-none">
        <View style={styles.bottomDock}>
          <Pressable style={styles.dockBtn} onPress={() => go('stats')}>
            <Text style={styles.dockIcon}>👤</Text>
            <Text style={styles.dockLabel}>
              Profile{profile.points.free > 0 ? ` (+${profile.points.free})` : ''}
            </Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable style={styles.dockBtn} onPress={() => go('pet')}>
            <Text style={styles.dockIcon}>🐾</Text>
            <Text style={styles.dockLabel}>Pets</Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable style={styles.dockBtn} onPress={() => go('bag')}>
            <Text style={styles.dockIcon}>🎒</Text>
            <Text style={styles.dockLabel}>Gear</Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable style={styles.dockBtn} onPress={() => go('myJutsu')}>
            <Text style={styles.dockIcon}>📜</Text>
            <Text style={styles.dockLabel}>Jutsu ({profile.equippedSkills.length}/8)</Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable style={styles.dockBtn} onPress={() => go('talent')}>
            <Text style={styles.dockIcon}>✨</Text>
            <Text style={styles.dockLabel}>Talents</Text>
          </Pressable>
          <View style={styles.dockSep} />
          <Pressable
            style={styles.dockBtn}
            onPress={() => {
              playClickSfx(serverUrl);
              setOptionOpen(true);
            }}
          >
            <Text style={styles.dockIcon}>⚙️</Text>
            <Text style={styles.dockLabel}>Option</Text>
          </Pressable>
        </View>
      </View>

      {/* 6) OPTION MODAL */}
      <Modal
        visible={optionOpen}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => setOptionOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOptionOpen(false)}>
          <Pressable style={styles.optionCard} onPress={() => {}}>
            <View style={styles.optionHeader}>
              <Text style={styles.optionTitle}>⚙️ OPTION</Text>
              <Pressable
                style={styles.optionCloseBtn}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setOptionOpen(false);
                }}
              >
                <Text style={styles.optionCloseTxt}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.optionRow}>
              <Text style={styles.optionRowLabel}>🎵 Background Music (BGM)</Text>
              <Pressable
                style={[styles.togglePill, !bgmOff && styles.togglePillOn]}
                onPress={() => {
                  const nextMuted = !bgmOff;
                  setBgmOff(nextMuted);
                  setBgmMuted(nextMuted);
                  playClickSfx(serverUrl);
                }}
              >
                <Text style={styles.togglePillTxt}>{bgmOff ? 'OFF' : 'ON'}</Text>
              </Pressable>
            </View>

            <View style={styles.optionRow}>
              <Text style={styles.optionRowLabel}>🔊 Sound Effects (SFX)</Text>
              <Pressable
                style={[styles.togglePill, !sfxOff && styles.togglePillOn]}
                onPress={() => {
                  const nextMuted = !sfxOff;
                  setSfxOff(nextMuted);
                  setSfxMuted(nextMuted);
                  if (!nextMuted) playClickSfx(serverUrl);
                }}
              >
                <Text style={styles.togglePillTxt}>{sfxOff ? 'OFF' : 'ON'}</Text>
              </Pressable>
            </View>

            <View style={styles.optionRow}>
              <Text style={styles.optionRowLabel}>🎨 Graphics Quality</Text>
              <View style={styles.qualityRow}>
                {(['low', 'medium', 'high'] as const).map((q) => (
                  <Pressable
                    key={q}
                    style={[styles.qualityBtn, graphicsQuality === q && styles.qualityBtnOn]}
                    onPress={() => {
                      playClickSfx(serverUrl);
                      setGraphicsQuality(q);
                    }}
                  >
                    <Text style={styles.qualityBtnTxt}>
                      {q === 'low' ? 'LOW' : q === 'medium' ? 'MED' : 'HIGH'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.optionInfoBox}>
              <Text style={styles.optionInfoLbl}>Server URL</Text>
              <Text style={styles.optionInfoVal} numberOfLines={1}>
                {serverUrl}
              </Text>
            </View>

            <View style={styles.optionActions}>
              <Pressable
                style={styles.optionActionBtn}
                onPress={() => {
                  setOptionOpen(false);
                  go('charSelect');
                }}
              >
                <Text style={styles.optionActionTxt}>🔄 Switch Character</Text>
              </Pressable>
              <Pressable
                style={[styles.optionActionBtn, styles.optionLogoutBtn]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setOptionOpen(false);
                  logout();
                }}
              >
                <Text style={styles.optionActionTxt}>🚪 Logout</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#3B6E38',
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
    width: 96,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signPlaque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(28, 16, 8, 0.90)',
    borderRadius: 8,
    borderWidth: 1.25,
    borderColor: '#D4AF37',
    paddingHorizontal: 7,
    paddingVertical: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.75,
    shadowRadius: 3,
    elevation: 6,
  },
  signPlaqueLocked: {
    opacity: 0.72,
    borderColor: '#94A3B8',
  },
  lockToast: {
    position: 'absolute',
    top: 86,
    alignSelf: 'center',
    backgroundColor: 'rgba(28, 16, 8, 0.94)',
    borderWidth: 1.5,
    borderColor: '#FACC15',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    zIndex: 30,
  },
  lockToastTxt: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '900',
  },
  signAccentDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  signIcon: {
    fontSize: 11,
  },
  signLabel: {
    color: '#FEF3C7',
    fontSize: 9.5,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  signPinStem: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 1.5,
    borderWidth: 1,
    borderColor: '#FEF3C7',
  },
  topHud: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  topLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamHudBtn: {
    width: 48,
    height: 54,
    borderRadius: 11,
    backgroundColor: 'rgba(8, 12, 22, 0.88)',
    borderWidth: 1.5,
    borderColor: '#C8A24A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  teamHudIcon: { fontSize: 15, lineHeight: 17 },
  teamHudCount: { color: '#FDE047', fontSize: 11, fontWeight: '900' },
  teamHudLabel: { color: '#CBD5E1', fontSize: 8, fontWeight: '800' },
  topRightCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  featureRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 20, 32, 0.88)',
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#C8A24A',
    paddingHorizontal: 6,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.65,
    shadowRadius: 4,
    elevation: 6,
  },
  ribbonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  ribbonIcon: {
    fontSize: 12,
  },
  ribbonLabel: {
    color: '#FEF3C7',
    fontSize: 10.5,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  ribbonSep: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(200, 162, 74, 0.35)',
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
  vitalBarBg: {
    height: 11,
    backgroundColor: '#1E293B',
    borderRadius: 5,
    borderWidth: 0.75,
    borderColor: '#475569',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  vitalBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
  },
  hpBarFill: {
    backgroundColor: '#DC2626',
  },
  cpBarFill: {
    backgroundColor: '#2563EB',
  },
  vitalBarLabel: {
    color: '#FFFFFF',
    fontSize: 7.5,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
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
  bottomLeftFloatRow: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 22,
  },
  chatFloatingBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(8, 12, 22, 0.9)',
    borderWidth: 1.75,
    borderColor: '#C8A24A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 8,
  },
  recruitFloatingBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 76, 58, 0.92)',
    borderWidth: 1.75,
    borderColor: '#34D399',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 8,
  },
  bookFloatingBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(58, 28, 10, 0.92)',
    borderWidth: 1.75,
    borderColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 8,
  },
  dailyFloatingBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(120, 53, 15, 0.92)',
    borderWidth: 1.75,
    borderColor: '#FACC15',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 8,
  },
  socialFloatingBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(30, 58, 138, 0.92)',
    borderWidth: 1.75,
    borderColor: '#60A5FA',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 8,
  },
  chatFloatingIcon: {
    fontSize: 16,
    lineHeight: 18,
  },
  chatFloatingLabel: {
    color: '#FDE047',
    fontSize: 8,
    fontWeight: '900',
  },
  bottomDockWrap: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    alignItems: 'flex-end',
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCard: {
    width: 340,
    backgroundColor: '#F5E6C4',
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: '#7C4D1E',
    padding: 14,
    gap: 10,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1.5,
    borderBottomColor: '#C8A24A',
    paddingBottom: 6,
  },
  optionTitle: {
    color: '#451A03',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  optionCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#B91C1C',
    borderWidth: 1.5,
    borderColor: '#FDE047',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCloseTxt: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EAD5A5',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#C29B52',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionRowLabel: {
    color: '#3B1D0A',
    fontSize: 12,
    fontWeight: '800',
  },
  togglePill: {
    minWidth: 52,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#64748B',
    alignItems: 'center',
  },
  togglePillOn: {
    backgroundColor: '#15803D',
  },
  togglePillTxt: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '900',
  },
  qualityRow: { flexDirection: 'row', gap: 4 },
  qualityBtn: {
    backgroundColor: '#64748B',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#4A2810',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  qualityBtnOn: { backgroundColor: '#EA580C' },
  qualityBtnTxt: { color: '#FFF', fontSize: 9.5, fontWeight: '900' },
  optionInfoBox: {
    backgroundColor: '#EAD5A5',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#C29B52',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  optionInfoLbl: {
    color: '#78350F',
    fontSize: 9.5,
    fontWeight: '800',
  },
  optionInfoVal: {
    color: '#1E293B',
    fontSize: 11,
    fontWeight: '700',
  },
  optionActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  optionActionBtn: {
    flex: 1,
    backgroundColor: '#1E3A8A',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#93C5FD',
    paddingVertical: 8,
    alignItems: 'center',
  },
  optionLogoutBtn: {
    backgroundColor: '#991B1B',
    borderColor: '#FCA5A5',
  },
  optionActionTxt: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '900',
  },
});
