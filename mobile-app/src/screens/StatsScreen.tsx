import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MobileApiClient } from '../api/client';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { buildPlayerSwfUrl } from '../config/env';
import { buildPlayerCombatant } from '../engine/battleEngine';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore, type CharacterPoints } from '../store/useAuthStore';

const STAT_META: Array<{
  key: keyof Omit<CharacterPoints, 'free'>;
  label: string;
  icon: string;
  color: string;
  bonus: string;
}> = [
  { key: 'wind', label: 'Wind', icon: '🌪️', color: '#15803D', bonus: '+0.4% Dodge & +1 Agility / pt' },
  { key: 'fire', label: 'Fire', icon: '🔥', color: '#DC2626', bonus: '+0.4% All DMG & Combustion / pt' },
  { key: 'lightning', label: 'Lightning', icon: '⚡', color: '#CA8A04', bonus: '+0.4% Crit & +0.8% Crit DMG / pt' },
  { key: 'water', label: 'Water', icon: '💧', color: '#0284C7', bonus: '+30 Max CP & Purify / pt' },
  { key: 'earth', label: 'Earth', icon: '🪨', color: '#92400E', bonus: '+30 Max HP & Reactive / pt' },
];

const RANK_LABELS: Record<number, string> = {
  1: 'Genin',
  3: 'Chunin',
  5: 'Jounin',
  7: 'Special Jounin',
  8: 'Sannin',
  10: 'Kage',
};

export function StatsScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [draftPoints, setDraftPoints] = useState<CharacterPoints>(
    () =>
      profile?.points ?? {
        wind: 0,
        fire: 0,
        lightning: 0,
        water: 0,
        earth: 0,
        free: 0,
      }
  );
  const [bridgeReady, setBridgeReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.points) {
      setDraftPoints(profile.points);
    }
  }, [profile?.points]);

  const equipTag = profile
    ? `${profile.hairStyle}_${profile.hairColor}_${profile.clothing}_${profile.weapon}_${profile.back}`
    : '';

  // Load live 36 FPS Ninja character standing inside the Stats panel just like authentic Ninja Saga!
  useEffect(() => {
    if (!profile || !bridgeReady) return;
    const url = buildPlayerSwfUrl(serverUrl, profile.charId, 'standby', equipTag);
    stageRef.current?.loadSwf(url);
  }, [serverUrl, profile, equipTag, bridgeReady]);

  const handleStageEvent = (ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') setBridgeReady(true);
  };

  if (!profile) return null;

  const previewStats = buildPlayerCombatant(profile.name, profile.level, draftPoints, 0);
  const rankLabel = RANK_LABELS[profile.rank] ?? 'Genin';
  const xpSpan = Math.max(1, profile.nextLevelXp - profile.prevLevelXp);
  const xpInto = Math.max(0, profile.xp - profile.prevLevelXp);
  const xpPct = `${Math.min(100, Math.max(0, Math.round((xpInto / xpSpan) * 100)))}%`;

  const hasUnsavedPoints =
    draftPoints.free !== profile.points.free ||
    draftPoints.wind !== profile.points.wind ||
    draftPoints.fire !== profile.points.fire ||
    draftPoints.lightning !== profile.points.lightning ||
    draftPoints.water !== profile.points.water ||
    draftPoints.earth !== profile.points.earth;

  const adjustStat = (key: keyof Omit<CharacterPoints, 'free'>, delta: 1 | -1) => {
    setDraftPoints((prev) => {
      if (delta === 1) {
        if (prev.free <= 0) return prev;
        return { ...prev, [key]: prev[key] + 1, free: prev.free - 1 };
      } else {
        const minAllowed = profile.points[key];
        if (prev[key] <= minAllowed) return prev;
        return { ...prev, [key]: prev[key] - 1, free: prev.free + 1 };
      }
    });
  };

  const handleSavePoints = async () => {
    if (!sessionKey) return;
    playClickSfx(serverUrl);
    setSaving(true);
    setNotice(null);
    try {
      const res = await api.rpc<Record<string, unknown>>(
        'CharacterService',
        'setPoints',
        [
          profile.charId,
          sessionKey,
          draftPoints.wind,
          draftPoints.fire,
          draftPoints.lightning,
          draftPoints.water,
          draftPoints.earth,
          draftPoints.free,
        ],
        { sessionKey, charId: profile.charId }
      );
      if ((res.data?.status as number) === 1) {
        const refreshed = await api.getCharacter(profile.charId, sessionKey);
        setProfileFromRaw(profile.charId, refreshed);
        setNotice('Attribute Points tersimpan! Stat karakter otomatis meningkat.');
      } else {
        setNotice(String(res.data?.error ?? 'Gagal menyimpan Attribute Points.'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const pct = (v?: number) => `${Math.round((v ?? 0) * 1000) / 10}%`;

  return (
    <NinjaScrollWindow
      title="Character Stats"
      bgSource={BUILDING_BGS.academy}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <Pressable
          style={[styles.saveBtn, (!hasUnsavedPoints || saving) && styles.disabledBtn]}
          disabled={!hasUnsavedPoints || saving}
          onPress={handleSavePoints}
        >
          <Text style={styles.saveBtnTxt}>{saving ? 'Saving...' : '✓ Save Points'}</Text>
        </Pressable>
      }
    >
      {notice && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{notice}</Text>
        </View>
      )}

      <View style={styles.body}>
        {/* Left: Live 36 FPS Character Pedestal + Basic Info (Authentic Ninja Saga!) */}
        <View style={styles.charCol}>
          <View style={styles.charTitleRow}>
            <Text style={styles.charName} numberOfLines={1}>
              {profile.name}
            </Text>
            <View style={styles.lvBadge}>
              <Text style={styles.lvBadgeTxt}>Lv.{profile.level}</Text>
            </View>
          </View>
          <Text style={styles.rankTxt}>
            Rank: {rankLabel} • TP: {profile.tp.toLocaleString()}
          </Text>

          <View style={styles.stageBox}>
            <RuffleStageView ref={stageRef} baseUrl={serverUrl} onEvent={handleStageEvent} />
          </View>

          <View style={styles.xpBarBg}>
            <View style={[styles.xpBarFill, { width: xpPct as `${number}%` }]} />
            <Text style={styles.xpBarTxt}>
              EXP {profile.xp.toLocaleString()} / {profile.nextLevelXp.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Middle: Derived Combat Stats */}
        <View style={styles.summaryPane}>
          <Text style={styles.sectionTitle}>COMBAT STATS</Text>
          <View style={styles.statGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>❤️ Max HP</Text>
              <Text style={styles.statNum}>{previewStats.maxHp}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>💧 Max CP</Text>
              <Text style={styles.statNum}>{previewStats.maxCp}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>⚡ Agility</Text>
              <Text style={styles.statNum}>{previewStats.agility}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>🎯 Critical</Text>
              <Text style={styles.statNum}>{pct(previewStats.critChance)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>💨 Dodge</Text>
              <Text style={styles.statNum}>{pct(previewStats.dodgeChance)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>✨ Purify</Text>
              <Text style={styles.statNum}>{pct(previewStats.purifyChance)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>🛡️ Reactive</Text>
              <Text style={styles.statNum}>{pct(previewStats.reactiveChance)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>🔥 Combust</Text>
              <Text style={styles.statNum}>{pct(previewStats.combustionChance)}</Text>
            </View>
          </View>
        </View>

        {/* Right: 5 Elemental Attribute Point Allocator */}
        <View style={styles.pointsPane}>
          <View style={styles.freeHeader}>
            <Text style={styles.freePtsTitle}>Attribute Points</Text>
            <View style={styles.freePill}>
              <Text style={styles.freePillTxt}>Free: {draftPoints.free}</Text>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.pointsList}>
            {STAT_META.map((st) => {
              const val = draftPoints[st.key];
              const savedVal = profile.points[st.key];
              return (
                <View key={st.key} style={styles.pointRow}>
                  <View style={[styles.dot, { backgroundColor: st.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pointName}>
                      {st.icon} {st.label}
                    </Text>
                    <Text style={styles.pointBonus}>{st.bonus}</Text>
                  </View>
                  <View style={styles.controls}>
                    <Pressable
                      style={[styles.pmBtn, val <= savedVal && styles.disabledBtn]}
                      disabled={val <= savedVal}
                      onPress={() => adjustStat(st.key, -1)}
                    >
                      <Text style={styles.pmTxt}>-</Text>
                    </Pressable>
                    <Text style={styles.pointVal}>{val}</Text>
                    <Pressable
                      style={[styles.pmBtn, draftPoints.free <= 0 && styles.disabledBtn]}
                      disabled={draftPoints.free <= 0}
                      onPress={() => adjustStat(st.key, 1)}
                    >
                      <Text style={styles.pmTxt}>+</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  saveBtn: {
    backgroundColor: NS_THEME.btnGreen,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 7,
  },
  saveBtnTxt: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  disabledBtn: { opacity: 0.45 },
  banner: {
    backgroundColor: '#DCFCE7',
    borderColor: NS_THEME.btnGreen,
    borderWidth: 1.5,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 5,
  },
  bannerText: { color: '#14532D', fontSize: 11, fontWeight: '800' },
  body: { flex: 1, flexDirection: 'row', gap: 8 },
  charCol: {
    width: '28%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
    gap: 4,
  },
  charTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  charName: { color: NS_THEME.inkDark, fontSize: 12.5, fontWeight: '900', flex: 1 },
  lvBadge: {
    backgroundColor: NS_THEME.btnOrange,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  lvBadgeTxt: { color: '#FFF', fontSize: 9.5, fontWeight: '900' },
  rankTxt: { color: NS_THEME.inkSoft, fontSize: 9.5, fontWeight: '800' },
  stageBox: {
    flex: 1,
    backgroundColor: NS_THEME.stageDark,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    overflow: 'hidden',
  },
  xpBarBg: {
    height: 14,
    backgroundColor: '#3E2008',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: NS_THEME.goldTrim,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  xpBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#22C55E',
  },
  xpBarTxt: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900',
    textAlign: 'center',
  },
  summaryPane: {
    width: '30%',
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
  },
  sectionTitle: { color: NS_THEME.inkDark, fontSize: 10, fontWeight: '900', marginBottom: 5, letterSpacing: 0.5 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  statCard: {
    width: '47.5%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 7,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    padding: 6,
  },
  statLbl: { color: NS_THEME.inkSoft, fontSize: 9, fontWeight: '800' },
  statNum: { color: NS_THEME.inkDark, fontSize: 12, fontWeight: '900', marginTop: 1 },
  pointsPane: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
  },
  freeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  freePtsTitle: { color: NS_THEME.inkDark, fontSize: 12, fontWeight: '900' },
  freePill: {
    backgroundColor: NS_THEME.btnGreen,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorderDark,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  freePillTxt: { color: '#FFF', fontSize: 10.5, fontWeight: '900' },
  pointsList: { gap: 5 },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pointName: { color: NS_THEME.inkDark, fontSize: 11.5, fontWeight: '900' },
  pointBonus: { color: NS_THEME.inkSoft, fontSize: 9, fontWeight: '700' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pmBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: NS_THEME.tabActive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pmTxt: { color: '#FFF', fontSize: 14, fontWeight: '900' },
  pointVal: { color: '#9A3412', fontSize: 13.5, fontWeight: '900', minWidth: 22, textAlign: 'center' },
});
