import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MobileApiClient } from '../api/client';
import { loadGameData, type SkillDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { JutsuPreviewModal } from '../components/JutsuPreviewModal';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
import { buildIconSheetSwfUrl, buildSwfAssetUrl } from '../config/env';
import { isSkillAoE } from '../engine/battleEngine';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

type AcademyMode = 'learn' | 'advance';

const LEARN_TABS: Array<{ type: string; elemId: number | null; label: string; icon: string; color: string }> = [
  { type: '1', elemId: 1, label: 'Wind', icon: '💨', color: '#059669' },
  { type: '2', elemId: 2, label: 'Fire', icon: '🔥', color: '#DC2626' },
  { type: '3', elemId: 3, label: 'Lightning', icon: '⚡', color: '#CA8A04' },
  { type: '4', elemId: 4, label: 'Earth', icon: '🪨', color: '#B45309' },
  { type: '5', elemId: 5, label: 'Water', icon: '💧', color: '#0284C7' },
  { type: '6', elemId: null, label: 'Taijutsu', icon: '🥋', color: '#C2410C' },
  { type: '7', elemId: null, label: 'Genjutsu', icon: '👁️', color: '#7C3AED' },
];

const ADVANCE_TABS: Array<{ key: string; elemId: number | null; label: string; icon: string }> = [
  { key: 'wind', elemId: 1, label: 'Wind', icon: '💨' },
  { key: 'fire', elemId: 2, label: 'Fire', icon: '🔥' },
  { key: 'thunder', elemId: 3, label: 'Lightning', icon: '⚡' },
  { key: 'earth', elemId: 4, label: 'Earth', icon: '🪨' },
  { key: 'water', elemId: 5, label: 'Water', icon: '💧' },
  { key: 'genjutsu', elemId: null, label: 'Genjutsu', icon: '👁️' },
];

const PAGE_SIZE = 24;

export function AdvanceAcademyScreen() {
  const iconBridgeRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const learnedElements = useMemo(
    () =>
      new Set(
        [profile?.element1, profile?.element2, profile?.element3].filter(
          (e): e is number => typeof e === 'number' && e >= 1 && e <= 5
        )
      ),
    [profile?.element1, profile?.element2, profile?.element3]
  );

  const visibleLearnTabs = useMemo(
    () => LEARN_TABS.filter((t) => t.elemId === null || learnedElements.has(t.elemId)),
    [learnedElements]
  );

  const visibleAdvanceTabs = useMemo(
    () => ADVANCE_TABS.filter((t) => t.elemId === null || learnedElements.has(t.elemId)),
    [learnedElements]
  );

  const [mode, setMode] = useState<AcademyMode>('learn');
  const [learnType, setLearnType] = useState<string>(() => visibleLearnTabs[0]?.type ?? '6');
  const [advElem, setAdvElem] = useState<string>(() => visibleAdvanceTabs[0]?.key ?? 'genjutsu');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [allSkills, setAllSkills] = useState<SkillDef[]>([]);
  const [skillsById, setSkillsById] = useState<Record<string, SkillDef>>({});
  const [chains, setChains] = useState<Record<string, Record<string, string[]>>>({});
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedChainKey, setSelectedChainKey] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<{ id: string; name: string } | null>(null);

  const [bridgeReady, setBridgeReady] = useState(false);
  const [iconUris, setIconUris] = useState<Record<string, string>>({});
  const requestedIconsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2000);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    if (visibleLearnTabs.length > 0 && !visibleLearnTabs.some((t) => t.type === learnType)) {
      setLearnType(visibleLearnTabs[0].type);
    }
  }, [visibleLearnTabs, learnType]);

  useEffect(() => {
    if (visibleAdvanceTabs.length > 0 && !visibleAdvanceTabs.some((t) => t.key === advElem)) {
      setAdvElem(visibleAdvanceTabs[0].key);
    }
  }, [visibleAdvanceTabs, advElem]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [feat, gd] = await Promise.all([api.getFeatureData(), loadGameData(serverUrl)]);
      setChains(feat.academy_chains ?? {});
      setSkillsById(gd.skillsById ?? {});
      setAllSkills(gd.skills ?? []);
    } catch (err) {
      setMessage(`Failed to load Ninja Academy: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, serverUrl]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const ownedSet = useMemo(() => new Set(profile?.ownedSkills ?? []), [profile?.ownedSkills]);
  const equippedSet = useMemo(() => new Set(profile?.equippedSkills ?? []), [profile?.equippedSkills]);

  const learnCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSkills
      .filter((s) => {
        if (!s.buyable || String(s.type) !== learnType) return false;
        if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.level - b.level || a.price_gold - b.price_gold || a.price_tokens - b.price_tokens);
  }, [allSkills, learnType, search]);

  const totalPages = Math.max(1, Math.ceil(learnCatalog.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedLearn = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return learnCatalog.slice(start, start + PAGE_SIZE);
  }, [learnCatalog, safePage]);

  const currentChainEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(chains[advElem] ?? {}).filter(([key, ids]) => {
      if (!q) return true;
      return (
        key.toLowerCase().includes(q) ||
        ids.some((id) => (skillsById[id]?.name ?? id).toLowerCase().includes(q))
      );
    });
  }, [chains, advElem, search, skillsById]);

  const selectedLearnSkill = useMemo(
    () => pagedLearn.find((s) => s.id === selectedSkillId) ?? pagedLearn[0] ?? null,
    [pagedLearn, selectedSkillId]
  );

  const selectedChain = useMemo(
    () =>
      currentChainEntries.find(([k]) => k === selectedChainKey) ?? currentChainEntries[0] ?? null,
    [currentChainEntries, selectedChainKey]
  );

  // Capture HD SWF icons only for visible items
  useEffect(() => {
    if (!bridgeReady) return;
    const targetIds =
      mode === 'learn'
        ? pagedLearn.map((s) => s.id)
        : currentChainEntries.flatMap(([, ids]) => ids);
    const missing = Array.from(new Set(targetIds)).filter(
      (id) => Boolean(id) && !iconUris[id] && !requestedIconsRef.current.has(id)
    );
    if (missing.length === 0) return;

    missing.forEach((id) => requestedIconsRef.current.add(id));
    for (let i = 0; i < missing.length; i += 12) {
      const chunk = missing.slice(i, i + 12);
      const url = buildIconSheetSwfUrl(serverUrl, 'skills', chunk.join(','));
      iconBridgeRef.current?.captureSkillIcons(url, chunk);
    }
  }, [bridgeReady, serverUrl, mode, pagedLearn, currentChainEntries, iconUris]);

  const handleBridgeEvent = useCallback((ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') setBridgeReady(true);
    else if (ev.type === 'SKILL_ICONS' && ev.icons) {
      setIconUris((prev) => ({ ...prev, ...ev.icons }));
    }
  }, []);

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
        setMessage(`Learned ${skill.name}!`);
        await refreshProfile();
      } else {
        setMessage(String(res.data?.result ?? res.data?.error ?? 'Failed to learn Jutsu.'));
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
        setMessage('At least 1 Jutsu must remain equipped.');
        return;
      }
      nextSkills = profile.equippedSkills.filter((id) => id !== skillId);
    } else {
      if (profile.equippedSkills.length >= 8) {
        setMessage('Maximum of 8 Jutsu can be equipped in the Battle Bar.');
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
      setMessage(`Loadout updated (${nextSkills.length}/8 Jutsu equipped).`);
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
        setMessage(`Upgraded to ${skName}!`);
        await refreshProfile();
      } else {
        setMessage(res.data?.result || res.data?.error || 'Upgrade failed.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const activeLearnTabMeta = LEARN_TABS.find((t) => t.type === learnType);

  return (
    <NinjaScrollWindow
      title="Ninja Academy"
      bgSource={BUILDING_BGS.academy}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <View style={styles.currencyPill}>
          <Text style={styles.currencyTxt}>
            🪙 {(profile?.gold ?? 0).toLocaleString()} • 💎 {(profile?.tokens ?? 0).toLocaleString()}
          </Text>
        </View>
      }
    >
      <View style={styles.hiddenBridge} pointerEvents="none">
        <RuffleStageView ref={iconBridgeRef} baseUrl={serverUrl} onEvent={handleBridgeEvent} />
      </View>

      <NinjaToast message={message} />

      <View style={styles.container}>

        {/* Top Bar: Academy / Advance Academy + Search */}
        <View style={styles.topBarRow}>
          <View style={styles.modeRow}>
            <Pressable
              style={[styles.mainTabBtn, mode === 'learn' && styles.mainTabBtnActive]}
              onPress={() => {
                playClickSfx(serverUrl);
                setMode('learn');
                setPage(1);
                setSearch('');
              }}
            >
              <Text style={[styles.mainTabTxt, mode === 'learn' && styles.mainTabTxtActive]}>
                📜 Academy
              </Text>
            </Pressable>
            <Pressable
              style={[styles.mainTabBtn, mode === 'advance' && styles.mainTabBtnActive]}
              onPress={() => {
                playClickSfx(serverUrl);
                setMode('advance');
                setSearch('');
              }}
            >
              <Text style={[styles.mainTabTxt, mode === 'advance' && styles.mainTabTxtActive]}>
                ⬆️ Advance Academy
              </Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={(txt) => {
              setSearch(txt);
              setPage(1);
            }}
            placeholder="Search Jutsu..."
            placeholderTextColor="#7A4C24"
          />
        </View>

        {/* Sub-Filter Row: Learned Elements + Taijutsu/Genjutsu */}
        <View style={styles.catRow}>
          {mode === 'learn'
            ? visibleLearnTabs.map((t) => (
                <Pressable
                  key={t.type}
                  style={[styles.catBtn, learnType === t.type && styles.catBtnActive]}
                  onPress={() => {
                    playClickSfx(serverUrl);
                    setLearnType(t.type);
                    setPage(1);
                  }}
                >
                  <Text style={[styles.catTxt, learnType === t.type && styles.catTxtActive]}>
                    {t.icon} {t.label}
                  </Text>
                </Pressable>
              ))
            : visibleAdvanceTabs.map((t) => (
                <Pressable
                  key={t.key}
                  style={[styles.catBtn, advElem === t.key && styles.catBtnActive]}
                  onPress={() => {
                    playClickSfx(serverUrl);
                    setAdvElem(t.key);
                  }}
                >
                  <Text style={[styles.catTxt, advElem === t.key && styles.catTxtActive]}>
                    {t.icon} {t.label}
                  </Text>
                </Pressable>
              ))}
        </View>

        {/* Encyclopedia Split View */}
        <View style={styles.splitBody}>
          {/* Left List Pane */}
          <View style={styles.leftCol}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
              </View>
            ) : mode === 'learn' ? (
              <>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listWrap}>
                  {pagedLearn.length === 0 ? (
                    <Text style={styles.emptyTxt}>No Jutsu available in this category.</Text>
                  ) : (
                    pagedLearn.map((sk) => {
                      const active = selectedLearnSkill?.id === sk.id;
                      const owned = ownedSet.has(sk.id);
                      const equipped = equippedSet.has(sk.id);
                      return (
                        <Pressable
                          key={sk.id}
                          style={[styles.tile, active && styles.tileActive]}
                          onPress={() => {
                            playClickSfx(serverUrl);
                            setSelectedSkillId(sk.id);
                          }}
                        >
                          <View style={styles.tileIconBox}>
                            {iconUris[sk.id] ? (
                              <Image
                                source={{ uri: iconUris[sk.id] }}
                                style={styles.tileIconImg}
                                resizeMode="contain"
                              />
                            ) : (
                              <Text style={styles.fallbackIcon}>📜</Text>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.tileName} numberOfLines={1}>
                              {sk.name}
                            </Text>
                            <Text style={styles.tileSub} numberOfLines={1}>
                              Lv.{sk.level} • DMG {sk.damage} • {sk.cp_cost} CP
                              {equipped ? ' • ★ EQUIPPED' : owned ? ' • ✓ OWNED' : ''}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>

                {totalPages > 1 ? (
                  <View style={styles.pageBar}>
                    <Pressable
                      style={[styles.pageBtn, safePage <= 1 && styles.btnDisabled]}
                      disabled={safePage <= 1}
                      onPress={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <Text style={styles.pageBtnTxt}>◀ Prev</Text>
                    </Pressable>
                    <Text style={styles.pageInfo}>
                      Page {safePage} / {totalPages}
                    </Text>
                    <Pressable
                      style={[styles.pageBtn, safePage >= totalPages && styles.btnDisabled]}
                      disabled={safePage >= totalPages}
                      onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <Text style={styles.pageBtnTxt}>Next ▶</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listWrap}>
                {currentChainEntries.length === 0 ? (
                  <Text style={styles.emptyTxt}>No Advance Academy chains available.</Text>
                ) : (
                  currentChainEntries.map(([chainKey, skillIds]) => {
                    const active = selectedChain?.[0] === chainKey;
                    const firstId = skillIds[0];
                    const ownedCount = skillIds.filter((id) => ownedSet.has(id)).length;
                    const displayId =
                      [...skillIds].reverse().find((id) => ownedSet.has(id)) ?? firstId;
                    const displaySkill = skillsById[displayId];
                    return (
                      <Pressable
                        key={chainKey}
                        style={[styles.tile, active && styles.tileActive]}
                        onPress={() => {
                          playClickSfx(serverUrl);
                          setSelectedChainKey(chainKey);
                        }}
                      >
                        <View style={styles.tileIconBox}>
                          {iconUris[displayId] ? (
                            <Image
                              source={{ uri: iconUris[displayId] }}
                              style={styles.tileIconImg}
                              resizeMode="contain"
                            />
                          ) : (
                            <Text style={styles.fallbackIcon}>⬆️</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.tileName} numberOfLines={1}>
                            {displaySkill?.name ?? chainKey}
                          </Text>
                          <Text style={styles.tileSub} numberOfLines={1}>
                            Unlocked Tiers: {ownedCount} / {skillIds.length}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            )}
          </View>

          {/* Right Detail Pane */}
          <View style={styles.rightCol}>
            {mode === 'learn' ? (
              selectedLearnSkill ? (() => {
                const owned = ownedSet.has(selectedLearnSkill.id);
                const equipped = equippedSet.has(selectedLearnSkill.id);
                const levelOk = (profile?.level ?? 1) >= selectedLearnSkill.level;
                return (
                  <View style={styles.detailCard}>
                    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
                      <View style={styles.detailHeader}>
                        <View style={styles.detailIconBig}>
                          {iconUris[selectedLearnSkill.id] ? (
                            <Image
                              source={{ uri: iconUris[selectedLearnSkill.id] }}
                              style={styles.detailIconImg}
                              resizeMode="contain"
                            />
                          ) : (
                            <Text style={{ fontSize: 24 }}>📜</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.detailTitle}>{selectedLearnSkill.name}</Text>
                          <View
                            style={[
                              styles.typeBadge,
                              { backgroundColor: activeLearnTabMeta?.color ?? '#B45309' },
                            ]}
                          >
                            <Text style={styles.typeBadgeTxt}>
                              {activeLearnTabMeta?.icon} {activeLearnTabMeta?.label} • Lv.
                              {selectedLearnSkill.level}
                            </Text>
                          </View>
                        </View>
                        <Pressable
                          style={styles.previewBtn}
                          onPress={() => {
                            playClickSfx(serverUrl);
                            setPreviewSkill({
                              id: selectedLearnSkill.id,
                              name: selectedLearnSkill.name,
                            });
                          }}
                        >
                          <Text style={styles.previewBtnTxt}>🎬 Preview</Text>
                        </Pressable>
                      </View>

                      <View style={styles.statChips}>
                        <Text style={styles.statChip}>⚔️ DMG: {selectedLearnSkill.damage}</Text>
                        <Text style={styles.statChip}>💧 CP: {selectedLearnSkill.cp_cost}</Text>
                        <Text style={styles.statChip}>⏱️ CD: {selectedLearnSkill.cooldown}t</Text>
                        <Text style={styles.statChip}>
                          🎯 {isSkillAoE(selectedLearnSkill) ? 'All Enemies' : 'Single'}
                        </Text>
                        {selectedLearnSkill.price_tokens > 0 ? (
                          <Text style={styles.statChip}>
                            💎 {selectedLearnSkill.price_tokens.toLocaleString()} Tokens
                          </Text>
                        ) : (
                          <Text style={styles.statChip}>
                            🪙 {selectedLearnSkill.price_gold.toLocaleString()} Gold
                          </Text>
                        )}
                      </View>

                      <View style={styles.descBox}>
                        <Text style={styles.descHeading}>Description</Text>
                        <Text style={styles.descBody}>
                          {selectedLearnSkill.description || 'Authentic ninja jutsu.'}
                        </Text>
                      </View>
                    </ScrollView>

                    {owned ? (
                      <Pressable
                        style={[
                          styles.actionBtn,
                          equipped ? styles.btnRed : styles.btnGreen,
                          busyId !== null && styles.btnDisabled,
                        ]}
                        disabled={busyId !== null}
                        onPress={() => handleToggleEquip(selectedLearnSkill.id)}
                      >
                        <Text style={styles.actionBtnTxt}>
                          {busyId === `eq_${selectedLearnSkill.id}`
                            ? 'Updating...'
                            : equipped
                            ? 'Unequip from Battle Bar'
                            : 'Equip to Battle Bar'}
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[
                          styles.actionBtn,
                          styles.btnOrange,
                          (!levelOk || busyId !== null) && styles.btnDisabled,
                        ]}
                        disabled={!levelOk || busyId !== null}
                        onPress={() => handleLearnSkill(selectedLearnSkill)}
                      >
                        <Text style={styles.actionBtnTxt}>
                          {busyId === selectedLearnSkill.id
                            ? 'Learning...'
                            : !levelOk
                            ? `Requires Level ${selectedLearnSkill.level}`
                            : selectedLearnSkill.price_tokens > 0
                            ? `Learn Jutsu (${selectedLearnSkill.price_tokens} Tokens)`
                            : `Learn Jutsu (${selectedLearnSkill.price_gold.toLocaleString()} Gold)`}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })() : (
                <View style={styles.center}>
                  <Text style={styles.emptyTxt}>Select a Jutsu to inspect or learn.</Text>
                </View>
              )
            ) : selectedChain ? (
              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>Upgrade Chain Tiers</Text>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
                  {selectedChain[1].map((sId, idx) => {
                    const sk = skillsById[sId];
                    const owned = ownedSet.has(sId);
                    const prevOwned = idx === 0 || ownedSet.has(selectedChain[1][idx - 1]);
                    const canUpgrade = !owned && prevOwned;
                    return (
                      <View
                        key={sId}
                        style={[
                          styles.tierCard,
                          owned && styles.tierCardOwned,
                          canUpgrade && styles.tierCardNext,
                        ]}
                      >
                        <View style={styles.tileIconBox}>
                          {iconUris[sId] ? (
                            <Image
                              source={{ uri: iconUris[sId] }}
                              style={styles.tileIconImg}
                              resizeMode="contain"
                            />
                          ) : (
                            <Text style={styles.fallbackIcon}>📜</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.tileName}>
                            Tier {idx + 1}: {sk?.name ?? sId}
                          </Text>
                          <Text style={styles.tileSub}>
                            Lv.{sk?.level ?? 1} • DMG {sk?.damage ?? 0} • {sk?.cp_cost ?? 0} CP
                          </Text>
                          <Text style={styles.tierDesc} numberOfLines={2}>
                            {sk?.description || ''}
                          </Text>
                        </View>
                        <View style={{ gap: 4, alignItems: 'flex-end' }}>
                          <Pressable
                            style={styles.miniPreviewBtn}
                            onPress={() => {
                              playClickSfx(serverUrl);
                              setPreviewSkill({ id: sId, name: sk?.name ?? sId });
                            }}
                          >
                            <Text style={styles.miniBtnTxt}>🎬</Text>
                          </Pressable>
                          {owned ? (
                            <Text style={styles.ownedTag}>✓ OWNED</Text>
                          ) : canUpgrade ? (
                            <Pressable
                              style={[styles.upgradeBtn, busyId !== null && styles.btnDisabled]}
                              disabled={busyId !== null}
                              onPress={() => handleUpgrade(sId)}
                            >
                              <Text style={styles.miniBtnTxt}>
                                {busyId === sId ? '...' : 'Upgrade'}
                              </Text>
                            </Pressable>
                          ) : (
                            <Text style={styles.lockTag}>🔒</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <View style={styles.center}>
                <Text style={styles.emptyTxt}>Select a chain to view upgrade tiers.</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <JutsuPreviewModal
        visible={previewSkill !== null}
        title={previewSkill?.name ?? 'Jutsu Preview'}
        skillId={previewSkill?.id ?? null}
        swfUrl={previewSkill ? buildSwfAssetUrl(serverUrl, 'skills', previewSkill.id) : null}
        serverUrl={serverUrl}
        onClose={() => setPreviewSkill(null)}
      />
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  hiddenBridge: { position: 'absolute', width: 1, height: 1, opacity: 0.01, left: -10, top: -10 },
  currencyPill: {
    backgroundColor: '#3E2008',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  currencyTxt: { color: '#FFE082', fontWeight: '800', fontSize: 11.5 },
  container: { flex: 1, gap: 6 },
  banner: {
    backgroundColor: '#3E2008',
    borderColor: NS_THEME.goldTrim,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  bannerText: { color: '#FFE082', fontWeight: '800', fontSize: 12, textAlign: 'center' },
  topBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeRow: { flexDirection: 'row', gap: 6, flex: 1.1 },
  mainTabBtn: {
    flex: 1,
    paddingVertical: 6.5,
    borderRadius: 8,
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    alignItems: 'center',
  },
  mainTabBtnActive: { backgroundColor: NS_THEME.tabActive, borderColor: '#FFE082' },
  mainTabTxt: { color: '#FFF4DC', fontWeight: '800', fontSize: 12 },
  mainTabTxtActive: { color: '#FFFFFF', fontWeight: '900' },
  searchInput: {
    flex: 1,
    maxWidth: 210,
    backgroundColor: '#FFF7E0',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    color: NS_THEME.inkDark,
    fontSize: 11.5,
    fontWeight: '700',
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  catBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 7,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
  },
  catBtnActive: { backgroundColor: '#D95B16', borderColor: '#FFE082' },
  catTxt: { color: NS_THEME.inkDark, fontWeight: '800', fontSize: 10.5 },
  catTxtActive: { color: '#FFFFFF' },
  splitBody: { flex: 1, flexDirection: 'row', gap: 10 },
  leftCol: { flex: 1.1, gap: 5 },
  rightCol: { flex: 1.15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listWrap: { gap: 5, paddingBottom: 8 },
  emptyTxt: { color: NS_THEME.inkSoft, fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 14 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    padding: 6,
  },
  tileActive: {
    backgroundColor: NS_THEME.parchmentSelected,
    borderColor: '#D95B16',
    borderWidth: 2,
  },
  tileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#231309',
    borderWidth: 1.5,
    borderColor: '#D9A438',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileIconImg: { width: 34, height: 34 },
  fallbackIcon: { fontSize: 16 },
  tileName: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 12 },
  tileSub: { color: NS_THEME.inkSoft, fontWeight: '700', fontSize: 9.5, marginTop: 1 },
  pageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pageBtn: { backgroundColor: NS_THEME.btnOrange, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  pageBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 10.5 },
  pageInfo: { color: NS_THEME.inkDark, fontWeight: '800', fontSize: 11 },
  detailCard: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 11,
    padding: 11,
    justifyContent: 'space-between',
    gap: 8,
  },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailIconBig: {
    width: 54,
    height: 54,
    borderRadius: 11,
    backgroundColor: '#231309',
    borderWidth: 2,
    borderColor: '#FACC15',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  detailIconImg: { width: 48, height: 48 },
  detailTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 15 },
  typeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 3,
  },
  typeBadgeTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 10 },
  previewBtn: {
    backgroundColor: NS_THEME.btnBlue,
    borderWidth: 1.5,
    borderColor: '#FFE082',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 11 },
  statChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  statChip: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    color: NS_THEME.inkDark,
    fontWeight: '800',
    fontSize: 10.5,
  },
  descBox: {
    backgroundColor: '#FFF7E0',
    borderWidth: 1.25,
    borderColor: '#D9A438',
    borderRadius: 8,
    padding: 9,
    gap: 3,
  },
  descHeading: { color: '#92400E', fontWeight: '900', fontSize: 10.5 },
  descBody: { color: NS_THEME.inkDark, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  actionBtn: {
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#3E2008',
    alignItems: 'center',
  },
  actionBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 12.5 },
  btnOrange: { backgroundColor: NS_THEME.btnOrange },
  btnGreen: { backgroundColor: NS_THEME.btnGreen },
  btnRed: { backgroundColor: NS_THEME.btnRed },
  btnDisabled: { opacity: 0.45 },
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    padding: 7,
  },
  tierCardOwned: { backgroundColor: '#E5F2D9', borderColor: '#2E8534' },
  tierCardNext: { backgroundColor: NS_THEME.parchmentSelected, borderColor: '#D95B16' },
  tierDesc: { color: NS_THEME.inkMid, fontSize: 10, marginTop: 2 },
  miniPreviewBtn: {
    backgroundColor: NS_THEME.btnBlue,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  upgradeBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  miniBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 10 },
  ownedTag: { color: '#15803D', fontWeight: '900', fontSize: 9.5 },
  lockTag: { fontSize: 12 },
});
