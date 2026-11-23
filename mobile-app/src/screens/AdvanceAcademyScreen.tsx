import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MobileApiClient } from '../api/client';
import { loadGameData, type SkillDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { buildPlayerSkillSwfUrl } from '../config/env';
import { getSkillElementMeta, isSkillAoE } from '../engine/battleEngine';
import { RuffleStageView, type RuffleStageHandle } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

type AcademyMode = 'learn' | 'advance';

const LEARN_ELEMENT_TABS: Array<{ type: string; label: string; icon: string; color: string }> = [
  { type: '1', label: 'Wind', icon: '🌪️', color: '#15803D' },
  { type: '2', label: 'Fire', icon: '🔥', color: '#B91C1C' },
  { type: '3', label: 'Lightning', icon: '⚡', color: '#A16207' },
  { type: '4', label: 'Earth', icon: '🪨', color: '#78350F' },
  { type: '5', label: 'Water', icon: '💧', color: '#1D4ED8' },
  { type: '6', label: 'Taijutsu', icon: '👊', color: '#9A3412' },
  { type: '7', label: 'Genjutsu', icon: '👁️', color: '#6D28D9' },
];

const ADVANCE_ELEM_TABS = ['fire', 'wind', 'thunder', 'earth', 'water', 'genjutsu'] as const;

export function AdvanceAcademyScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [mode, setMode] = useState<AcademyMode>('learn');
  const [learnType, setLearnType] = useState<string>(() => String(profile?.element1 || '2'));
  const [advElem, setAdvElem] = useState<string>('fire');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [allSkills, setAllSkills] = useState<SkillDef[]>([]);
  const [skillsById, setSkillsById] = useState<Record<string, SkillDef>>({});
  const [chains, setChains] = useState<Record<string, Record<string, string[]>>>({});
  const [selectedSkillId, setSelectedSkillId] = useState<string>('skill_01');

  const equipTag = profile
    ? `${profile.hairStyle}_${profile.clothing}_${profile.weapon}_${profile.back}`
    : '';

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [feat, gd] = await Promise.all([api.getFeatureData(), loadGameData(serverUrl)]);
      setChains(feat.academy_chains ?? {});
      setSkillsById(gd.skillsById ?? {});
      setAllSkills(gd.skills ?? []);
    } catch (err) {
      setMessage(`Gagal memuat Ninja Academy: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, serverUrl]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const ownedSet = useMemo(() => new Set(profile?.ownedSkills ?? []), [profile?.ownedSkills]);
  const equippedSet = useMemo(() => new Set(profile?.equippedSkills ?? []), [profile?.equippedSkills]);

  // Authentic Ninja Saga Academy catalog: ALL buyable jutsus for the selected Element tab!
  const learnCatalog = useMemo(() => {
    return allSkills
      .filter((s) => s.buyable && String(s.type) === learnType)
      .sort((a, b) => a.level - b.level || a.price_gold - b.price_gold || a.price_tokens - b.price_tokens);
  }, [allSkills, learnType]);

  // Keep selectedSkillId synced when changing element tab
  useEffect(() => {
    if (mode !== 'learn' || learnCatalog.length === 0) return;
    if (!learnCatalog.some((s) => s.id === selectedSkillId)) {
      setSelectedSkillId(learnCatalog[0].id);
    }
  }, [mode, learnCatalog, selectedSkillId]);

  // Load live 36 FPS Ruffle Jutsu preview when selectedSkillId changes
  useEffect(() => {
    if (mode !== 'learn' || !profile || !selectedSkillId) return;
    const timer = setTimeout(() => {
      const url = buildPlayerSkillSwfUrl(serverUrl, profile.charId, selectedSkillId, equipTag);
      stageRef.current?.loadSwf(url);
    }, 220);
    return () => clearTimeout(timer);
  }, [mode, serverUrl, profile, selectedSkillId, equipTag]);

  const refreshProfile = async () => {
    if (!profile || !sessionKey) return;
    const raw = await api.getCharacter(profile.charId, sessionKey);
    setProfileFromRaw(profile.charId, raw);
  };

  const handleLearnSkill = async (skill: SkillDef) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(skill.id);
    setMessage(null);
    try {
      const res = await api.rpc<Record<string, unknown>>(
        'CharacterService',
        'buySkill',
        [sessionKey, profile.charId, skill.id],
        { sessionKey, charId: profile.charId }
      );
      if ((res.data?.status as number) === 1) {
        setMessage(`Berhasil mempelajari ${skill.name}!`);
        await refreshProfile();
      } else {
        setMessage(String(res.data?.result ?? res.data?.error ?? 'Gagal mempelajari Jutsu.'));
      }
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleEquip = async (skillId: string) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    const isEquipped = profile.equippedSkills.includes(skillId);
    let nextSkills: string[];
    if (isEquipped) {
      if (profile.equippedSkills.length <= 1) {
        setMessage('Minimal 1 Jutsu harus tetap terpasang.');
        return;
      }
      nextSkills = profile.equippedSkills.filter((id) => id !== skillId);
    } else {
      if (profile.equippedSkills.length >= 6) {
        setMessage('Maksimal 6 Jutsu yang bisa dipasang di Battle Bar.');
        return;
      }
      nextSkills = [...profile.equippedSkills, skillId];
    }

    setBusyId(`eq_${skillId}`);
    setMessage(null);
    try {
      await api.rpc(
        'CharacterService',
        'equipSkillSet',
        [profile.charId, sessionKey, nextSkills.join(',')],
        { sessionKey, charId: profile.charId }
      );
      await refreshProfile();
      setMessage(`Loadout diperbarui (${nextSkills.length}/6 Jutsu terpasang).`);
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const handleUpgrade = async (nextSkillId: string) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(nextSkillId);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'AdvanceAcademyService',
        'upgradeSkill',
        [profile.charId, sessionKey, nextSkillId],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        const skName = skillsById[nextSkillId]?.name ?? nextSkillId;
        setMessage(`Berhasil upgrade ke ${skName}!`);
        await refreshProfile();
      } else {
        setMessage(res.data?.result || res.data?.error || 'Upgrade gagal.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const selectedSkill = skillsById[selectedSkillId] ?? learnCatalog[0] ?? null;
  const currentChains = chains[advElem] ?? {};

  return (
    <NinjaScrollWindow
      title="Academy"
      bgSource={BUILDING_BGS.academy}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      headerCenter={
        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeBtn, mode === 'learn' && styles.modeBtnActive]}
            onPress={() => {
              playClickSfx(serverUrl);
              setMode('learn');
            }}
          >
            <Text style={[styles.modeBtnText, mode === 'learn' && styles.modeBtnTextActive]}>
              📜 Academy (Jutsu)
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeBtn, mode === 'advance' && styles.modeBtnActive]}
            onPress={() => {
              playClickSfx(serverUrl);
              setMode('advance');
            }}
          >
            <Text style={[styles.modeBtnText, mode === 'advance' && styles.modeBtnTextActive]}>
              ⚡ Advance Academy
            </Text>
          </Pressable>
        </View>
      }
      rightContent={
        <View style={styles.currencyPill}>
          <Text style={styles.currency}>
            🪙 {(profile?.gold ?? 0).toLocaleString()} • 💎 {(profile?.tokens ?? 0).toLocaleString()}
          </Text>
        </View>
      }
    >

      {message && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{message}</Text>
        </View>
      )}

      {/* MODE 1: AUTHENTIC NINJA SAGA ACADEMY (LEARN & EQUIP ALL 250 BUYABLE JUTSUS) */}
      {mode === 'learn' && (
        <View style={styles.learnWrap}>
          {/* Element Tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.elemScroll}
            contentContainerStyle={styles.tabRow}
          >
            {LEARN_ELEMENT_TABS.map((el) => {
              const active = learnType === el.type;
              return (
                <Pressable
                  key={el.type}
                  style={[
                    styles.tabBtn,
                    active && { backgroundColor: el.color, borderColor: '#FACC15', borderWidth: 1 },
                  ]}
                  onPress={() => {
                    playClickSfx(serverUrl);
                    setLearnType(el.type);
                  }}
                >
                  <Text style={styles.tabText}>
                    {el.icon} {el.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {loading ? (
            <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
          ) : (
            <View style={styles.splitBody}>
              {/* Left: Live 36 FPS Jutsu Animation Preview + Details + Action */}
              <View style={styles.previewPane}>
                <View style={styles.previewStageBox}>
                  <RuffleStageView ref={stageRef} baseUrl={serverUrl} />
                </View>

                {selectedSkill && (
                  <View style={styles.detailCard}>
                    <View style={styles.detailTop}>
                      <Text style={styles.detailName} numberOfLines={1}>
                        {getSkillElementMeta(selectedSkill.type).icon} {selectedSkill.name}
                      </Text>
                      {isSkillAoE(selectedSkill) && (
                        <View style={styles.aoeTag}>
                          <Text style={styles.aoeTagText}>AoE</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.detailStats}>
                      Lv.{selectedSkill.level} • DMG {selectedSkill.damage} • CP {selectedSkill.cp_cost} • CD {selectedSkill.cooldown}t
                    </Text>
                    <Text style={styles.detailDesc} numberOfLines={3}>
                      {selectedSkill.description || 'Ninjutsu Academy technique.'}
                    </Text>

                    <View style={styles.detailActions}>
                      {ownedSet.has(selectedSkill.id) ? (
                        <Pressable
                          style={[
                            styles.actionBtn,
                            equippedSet.has(selectedSkill.id) ? styles.unequipBtn : styles.equipBtn,
                          ]}
                          disabled={busyId !== null}
                          onPress={() => handleToggleEquip(selectedSkill.id)}
                        >
                          <Text style={styles.actionBtnText}>
                            {busyId === `eq_${selectedSkill.id}`
                              ? '...'
                              : equippedSet.has(selectedSkill.id)
                                ? '✓ Equipped (Tap to Unequip)'
                                : '+ Equip to Battle Bar'}
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          style={[
                            styles.actionBtn,
                            styles.learnBtn,
                            (profile?.level ?? 1) < selectedSkill.level && styles.btnLocked,
                          ]}
                          disabled={(profile?.level ?? 1) < selectedSkill.level || busyId !== null}
                          onPress={() => handleLearnSkill(selectedSkill)}
                        >
                          <Text style={styles.actionBtnText}>
                            {busyId === selectedSkill.id
                              ? 'Learning...'
                              : (profile?.level ?? 1) < selectedSkill.level
                                ? `Requires Lv.${selectedSkill.level}`
                                : selectedSkill.price_tokens > 0
                                  ? `Learn (${selectedSkill.price_tokens} Tokens)`
                                  : `Learn (${selectedSkill.price_gold.toLocaleString()} Gold)`}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>

              {/* Right: Scrollable Jutsu Grid for Selected Element */}
              <View style={styles.catalogPane}>
                <Text style={styles.catalogHeader}>
                  {LEARN_ELEMENT_TABS.find((t) => t.type === learnType)?.label} Jutsu ({learnCatalog.length}) • Equipped {profile?.equippedSkills.length ?? 0}/6
                </Text>
                <ScrollView contentContainerStyle={styles.grid}>
                  {learnCatalog.map((sk) => {
                    const owned = ownedSet.has(sk.id);
                    const equipped = equippedSet.has(sk.id);
                    const selected = selectedSkill?.id === sk.id;
                    const locked = (profile?.level ?? 1) < sk.level;
                    return (
                      <Pressable
                        key={sk.id}
                        style={[
                          styles.skillCard,
                          owned && styles.skillCardOwned,
                          selected && styles.skillCardSelected,
                        ]}
                        onPress={() => {
                          playClickSfx(serverUrl);
                          setSelectedSkillId(sk.id);
                        }}
                      >
                        <View style={styles.cardTopRow}>
                          <Text style={styles.cardName} numberOfLines={1}>
                            {sk.name}
                          </Text>
                          {equipped ? (
                            <Text style={styles.badgeEq}>★</Text>
                          ) : owned ? (
                            <Text style={styles.badgeOwn}>✓</Text>
                          ) : null}
                        </View>
                        <Text style={styles.cardMeta}>
                          Lv.{sk.level} • DMG {sk.damage} • {sk.cp_cost} CP
                        </Text>
                        <Text
                          style={[
                            styles.cardPrice,
                            owned && { color: '#15803D' },
                            !owned && locked && { color: NS_THEME.inkSoft },
                          ]}
                        >
                          {equipped
                            ? 'EQUIPPED'
                            : owned
                              ? 'OWNED'
                              : sk.price_tokens > 0
                                ? `${sk.price_tokens} Tokens`
                                : `${sk.price_gold.toLocaleString()} Gold`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          )}
        </View>
      )}

      {/* MODE 2: ADVANCE ACADEMY (TIER 1-5 UPGRADE CHAINS) */}
      {mode === 'advance' && (
        <View style={styles.learnWrap}>
          <View style={styles.tabRow}>
            {ADVANCE_ELEM_TABS.map((el) => (
              <Pressable
                key={el}
                style={[styles.tabBtn, advElem === el && styles.tabActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setAdvElem(el);
                }}
              >
                <Text style={styles.tabText}>{el.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          {loading ? (
            <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {Object.entries(currentChains).length === 0 ? (
                <Text style={styles.emptyText}>Tidak ada chain upgrade untuk elemen {advElem}.</Text>
              ) : (
                Object.entries(currentChains).map(([chainName, skillIds]) => (
                  <View key={chainName} style={styles.chainCard}>
                    <Text style={styles.chainTitle}>
                      {chainName.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.tierRow}
                    >
                      {skillIds.map((sid, idx) => {
                        const sk = skillsById[sid];
                        const owned = ownedSet.has(sid);
                        const prevOwned = idx === 0 || ownedSet.has(skillIds[idx - 1]);
                        const canUpgrade = !owned && prevOwned;
                        return (
                          <View
                            key={sid}
                            style={[
                              styles.tierBox,
                              owned && styles.tierOwned,
                              canUpgrade && styles.tierReady,
                            ]}
                          >
                            <Text style={styles.tierName} numberOfLines={1}>
                              T{idx + 1}: {sk?.name ?? sid}
                            </Text>
                            <Text style={styles.tierMeta}>
                              Lv.{sk?.level ?? 1} • DMG {sk?.damage ?? 0} • CP {sk?.cp_cost ?? 0}
                            </Text>
                            <Text style={styles.tierCost}>
                              {sk?.price_gold ? `${sk.price_gold.toLocaleString()}G` : ''}
                              {sk?.price_tokens ? ` ${sk.price_tokens}T` : ''}
                            </Text>
                            {owned ? (
                              <Text style={styles.ownedTag}>✓ OWNED</Text>
                            ) : (
                              <Pressable
                                style={[styles.upBtn, !canUpgrade && styles.upBtnDisabled]}
                                disabled={!canUpgrade || busyId !== null}
                                onPress={() => handleUpgrade(sid)}
                              >
                                <Text style={styles.upBtnText}>
                                  {busyId === sid ? '...' : canUpgrade ? 'Upgrade' : 'Locked'}
                                </Text>
                              </Pressable>
                            )}
                          </View>
                        );
                      })}
                    </ScrollView>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </View>
      )}
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', gap: 5 },
  modeBtn: {
    backgroundColor: NS_THEME.tabInactive,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
  },
  modeBtnActive: { backgroundColor: NS_THEME.tabActive, borderColor: NS_THEME.woodBorderDark },
  modeBtnText: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900' },
  modeBtnTextActive: { color: '#FFF' },
  currencyPill: {
    backgroundColor: '#3E2008',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  currency: { color: '#FDE047', fontSize: 10.5, fontWeight: '900' },
  banner: {
    backgroundColor: '#FEF3C7',
    borderColor: '#B45309',
    borderWidth: 1.5,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 5,
  },
  bannerText: { color: '#78350F', fontSize: 11, fontWeight: '800' },
  learnWrap: { flex: 1 },
  elemScroll: { maxHeight: 34, marginBottom: 6 },
  tabRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  tabBtn: {
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tabActive: { backgroundColor: NS_THEME.tabActive, borderColor: NS_THEME.woodBorderDark },
  tabText: { color: '#FFF', fontSize: 10.5, fontWeight: '900' },
  splitBody: { flex: 1, flexDirection: 'row', gap: 8 },
  previewPane: {
    width: '37%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
    gap: 6,
  },
  previewStageBox: {
    flex: 1,
    backgroundColor: NS_THEME.stageDark,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    overflow: 'hidden',
  },
  detailCard: { gap: 3 },
  detailTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  detailName: { color: NS_THEME.inkDark, fontSize: 12, fontWeight: '900', flex: 1 },
  aoeTag: { backgroundColor: '#B45309', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  aoeTagText: { color: '#FFF', fontSize: 8, fontWeight: '900' },
  detailStats: { color: '#9A3412', fontSize: 10, fontWeight: '900' },
  detailDesc: { color: NS_THEME.inkMid, fontSize: 9.5, fontWeight: '600', lineHeight: 13 },
  detailActions: { marginTop: 4 },
  actionBtn: {
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    paddingVertical: 7,
    alignItems: 'center',
  },
  learnBtn: { backgroundColor: NS_THEME.btnOrange },
  equipBtn: { backgroundColor: NS_THEME.btnGreen },
  unequipBtn: { backgroundColor: NS_THEME.btnBlue },
  btnLocked: { backgroundColor: NS_THEME.btnDisabled, opacity: 0.7 },
  actionBtnText: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  catalogPane: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
  },
  catalogHeader: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900', marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 14 },
  skillCard: {
    width: '31.8%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 6,
    gap: 2,
  },
  skillCardOwned: { borderColor: NS_THEME.btnGreen, backgroundColor: '#E7F6E5' },
  skillCardSelected: { borderColor: NS_THEME.btnOrange, borderWidth: 2, backgroundColor: NS_THEME.parchmentSelected },
  cardBodyRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  skillIconBox: {
    width: 30,
    height: 30,
    borderRadius: 5,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    backgroundColor: NS_THEME.stageDark,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillIconImg: { width: '100%', height: '100%' },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 2 },
  cardName: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900', flex: 1 },
  badgeEq: { color: '#D97706', fontSize: 11, fontWeight: '900' },
  badgeOwn: { color: '#15803D', fontSize: 10, fontWeight: '900' },
  cardMeta: { color: NS_THEME.inkSoft, fontSize: 8.5, fontWeight: '700' },
  cardPrice: { color: '#B45309', fontSize: 9, fontWeight: '900', marginTop: 1 },
  list: { gap: 8, paddingBottom: 16 },
  emptyText: { color: NS_THEME.inkMid, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 24 },
  chainCard: {
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 8,
  },
  chainTitle: { color: NS_THEME.inkDark, fontSize: 11, fontWeight: '900', marginBottom: 6 },
  tierRow: { gap: 8 },
  tierBox: {
    width: 155,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
    justifyContent: 'space-between',
  },
  tierOwned: { borderColor: NS_THEME.btnGreen, backgroundColor: '#E7F6E5' },
  tierReady: { borderColor: NS_THEME.btnOrange },
  tierName: { color: NS_THEME.inkDark, fontSize: 11, fontWeight: '900' },
  tierMeta: { color: NS_THEME.inkSoft, fontSize: 9, fontWeight: '700', marginTop: 2 },
  tierCost: { color: '#B45309', fontSize: 9, fontWeight: '800', marginTop: 2 },
  ownedTag: { color: '#15803D', fontSize: 10, fontWeight: '900', marginTop: 6, textAlign: 'center' },
  upBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    borderRadius: 5,
    paddingVertical: 4,
    marginTop: 6,
    alignItems: 'center',
  },
  upBtnDisabled: { backgroundColor: NS_THEME.btnDisabled, opacity: 0.6 },
  upBtnText: { color: '#FFF', fontSize: 10, fontWeight: '900' },
});
