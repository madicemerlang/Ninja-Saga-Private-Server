import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MobileApiClient } from '../api/client';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
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

const ELEMENT_META: Record<number, { label: string; icon: string; color: string }> = {
  1: { label: 'Wind', icon: '🌪️', color: '#15803D' },
  2: { label: 'Fire', icon: '🔥', color: '#DC2626' },
  3: { label: 'Lightning', icon: '⚡', color: '#CA8A04' },
  4: { label: 'Earth', icon: '🪨', color: '#92400E' },
  5: { label: 'Water', icon: '💧', color: '#0284C7' },
};

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
  const accountType = useAuthStore((s) => s.accountType);
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
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resettingElem, setResettingElem] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

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
        setNotice('Attribute Points saved! Your character stats have been updated.');
      } else {
        setNotice(String(res.data?.error ?? 'Failed to save Attribute Points.'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const learnedElements = [profile.element1, profile.element2, profile.element3].filter(
    (id): id is number => id >= 1 && id <= 5
  );

  const handleResetElement = async (elemId: number) => {
    if (!sessionKey) return;
    playClickSfx(serverUrl);
    setResettingElem(elemId);
    setNotice(null);
    try {
      const res = await api.rpc<Record<string, unknown>>(
        'CharacterService',
        'resetElement',
        [profile.charId, sessionKey, elemId],
        { sessionKey, charId: profile.charId }
      );
      if ((res.data?.status as number) === 1) {
        const refreshed = await api.getCharacter(profile.charId, sessionKey);
        setProfileFromRaw(profile.charId, refreshed);
        setResetModalOpen(false);
        setNotice(`${ELEMENT_META[elemId]?.label ?? 'Element'} has been reset! Attribute points refunded.`);
      } else {
        setNotice(String(res.data?.error ?? 'Failed to reset element.'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setResettingElem(null);
    }
  };

  const pct = (v?: number) => `${Math.round((v ?? 0) * 1000) / 10}%`;

  return (
    <NinjaScrollWindow
      title="Profile"
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
      <NinjaToast message={notice} />

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
          <View style={styles.rankRow}>
            <Text style={styles.rankTxt}>
              Rank: {rankLabel} • TP: {profile.tp.toLocaleString()}
            </Text>
            <View style={[styles.acctBadge, accountType >= 1 ? styles.acctPrem : styles.acctFree]}>
              <Text style={[styles.acctBadgeTxt, accountType >= 1 ? styles.acctPremTxt : styles.acctFreeTxt]}>
                {accountType >= 1 ? '★ Premium User' : 'Free User'}
              </Text>
            </View>
          </View>

          <View style={styles.elemRow}>
            <View style={styles.elemBadgesWrap}>
              {learnedElements.length > 0 ? (
                learnedElements.map((eid) => {
                  const em = ELEMENT_META[eid];
                  return (
                    <View
                      key={eid}
                      style={[styles.elemChip, { backgroundColor: em?.color ?? '#334155' }]}
                    >
                      <Text style={styles.elemChipTxt}>
                        {em?.icon} {em?.label}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.noElemTxt}>No Element</Text>
              )}
            </View>
            {learnedElements.length > 0 ? (
              <Pressable
                style={styles.resetElemBtn}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setResetModalOpen(true);
                }}
              >
                <Text style={styles.resetElemTxt}>🔄 Reset</Text>
              </Pressable>
            ) : null}
          </View>

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
            <View style={styles.statPairRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLbl}>❤️ Max HP</Text>
                <Text style={styles.statNum}>{previewStats.maxHp.toLocaleString()}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLbl}>💧 Max CP</Text>
                <Text style={styles.statNum}>{previewStats.maxCp.toLocaleString()}</Text>
              </View>
            </View>
            <View style={styles.statPairRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLbl}>⚡ Agility</Text>
                <Text style={styles.statNum}>{previewStats.agility}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLbl}>🎯 Critical</Text>
                <Text style={styles.statNum}>{pct(previewStats.critChance)}</Text>
              </View>
            </View>
            <View style={styles.statPairRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLbl}>💨 Dodge</Text>
                <Text style={styles.statNum}>{pct(previewStats.dodgeChance)}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLbl}>✨ Purify</Text>
                <Text style={styles.statNum}>{pct(previewStats.purifyChance)}</Text>
              </View>
            </View>
            <View style={styles.statPairRow}>
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
        </View>

        {/* Right: 5 Elemental Attribute Point Allocator */}
        <View style={styles.pointsPane}>
          <View style={styles.freeHeader}>
            <Text style={styles.freePtsTitle}>Attribute Points</Text>
            <View style={styles.freePill}>
              <Text style={styles.freePillTxt}>Free: {draftPoints.free}</Text>
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pointsList}>
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

      {/* Reset Element Modal */}
      <Modal
        visible={resetModalOpen}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => {
          if (resettingElem === null) setResetModalOpen(false);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => resettingElem === null && setResetModalOpen(false)}
        >
          <Pressable style={styles.resetModalCard} onPress={() => {}}>
            <View style={styles.resetModalHeader}>
              <Text style={styles.resetModalTitle}>🔄 Reset Element</Text>
              <Pressable
                style={styles.resetCloseBtn}
                disabled={resettingElem !== null}
                onPress={() => setResetModalOpen(false)}
              >
                <Text style={styles.resetCloseTxt}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.resetModalDesc}>
              Select a learned element to reset. All attribute points invested in that element will be refunded to Free Points, and jutsu of that element will be unlearned.
            </Text>
            <View style={styles.resetElemList}>
              {learnedElements.map((eid) => {
                const em = ELEMENT_META[eid];
                const isBusy = resettingElem === eid;
                return (
                  <Pressable
                    key={eid}
                    style={[styles.resetChoiceBtn, { borderColor: em?.color ?? NS_THEME.woodBorder }]}
                    disabled={resettingElem !== null}
                    onPress={() => handleResetElement(eid)}
                  >
                    <View style={[styles.elemDotBig, { backgroundColor: em?.color ?? '#334155' }]}>
                      <Text style={{ fontSize: 13 }}>{em?.icon}</Text>
                    </View>
                    <Text style={styles.resetChoiceLbl}>
                      {isBusy ? `Resetting ${em?.label}...` : `Reset ${em?.label}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
    width: '32%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 6,
    gap: 4,
  },
  charTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  acctBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  acctPrem: {
    backgroundColor: 'rgba(180, 83, 9, 0.2)',
    borderColor: '#D97706',
  },
  acctFree: {
    backgroundColor: 'rgba(100, 116, 139, 0.16)',
    borderColor: '#64748B',
  },
  acctBadgeTxt: {
    fontSize: 8.5,
    fontWeight: '900',
  },
  acctPremTxt: {
    color: '#B45309',
  },
  acctFreeTxt: {
    color: '#475569',
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
  elemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  elemBadgesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    flex: 1,
  },
  elemChip: {
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.28)',
  },
  elemChipTxt: { color: '#FFF', fontSize: 8.5, fontWeight: '900' },
  noElemTxt: { color: NS_THEME.inkSoft, fontSize: 8.5, fontWeight: '700' },
  resetElemBtn: {
    backgroundColor: NS_THEME.btnRed,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorderDark,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  resetElemTxt: { color: '#FFF', fontSize: 8.5, fontWeight: '900' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  resetModalCard: {
    width: 340,
    maxWidth: '92%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorderDark,
    padding: 12,
    gap: 10,
  },
  resetModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resetModalTitle: { color: NS_THEME.inkDark, fontSize: 13.5, fontWeight: '900' },
  resetCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NS_THEME.btnRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetCloseTxt: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  resetModalDesc: { color: NS_THEME.inkMid, fontSize: 10.5, fontWeight: '600', lineHeight: 15 },
  resetElemList: { gap: 6 },
  resetChoiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  elemDotBig: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetChoiceLbl: { color: NS_THEME.inkDark, fontSize: 11.5, fontWeight: '900' },
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
    padding: 8,
  },
  sectionTitle: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900', marginBottom: 6, letterSpacing: 0.6 },
  statGrid: { flex: 1, gap: 6 },
  statPairRow: { flex: 1, flexDirection: 'row', gap: 6 },
  statCard: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  statLbl: { color: NS_THEME.inkSoft, fontSize: 9.5, fontWeight: '800' },
  statNum: { color: NS_THEME.inkDark, fontSize: 14, fontWeight: '900', marginTop: 2 },
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
