import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const ALL_JUTSU_TABS: Array<{ key: string; label: string; icon: string; color: string }> = [
  { key: '1', label: 'Wind', icon: '💨', color: '#059669' },
  { key: '2', label: 'Fire', icon: '🔥', color: '#DC2626' },
  { key: '3', label: 'Lightning', icon: '⚡', color: '#CA8A04' },
  { key: '4', label: 'Earth', icon: '🪨', color: '#B45309' },
  { key: '5', label: 'Water', icon: '💧', color: '#0284C7' },
  { key: '6', label: 'Taijutsu', icon: '🥋', color: '#C2410C' },
  { key: '7', label: 'Genjutsu', icon: '👁️', color: '#7C3AED' },
];

const EQUIP_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const PAGE_SIZE = 24;

export function MyJutsuScreen() {
  const iconBridgeRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  // Only show elements learned by this character (+ Taijutsu & Genjutsu)
  const visibleTabs = useMemo(() => {
    const learnedElemKeys = new Set(
      [profile?.element1, profile?.element2, profile?.element3]
        .filter((e): e is number => typeof e === 'number' && e >= 1 && e <= 5)
        .map((e) => String(e))
    );
    return ALL_JUTSU_TABS.filter(
      (t) => t.key === '6' || t.key === '7' || learnedElemKeys.has(t.key)
    );
  }, [profile?.element1, profile?.element2, profile?.element3]);

  const [skillsById, setSkillsById] = useState<Record<string, SkillDef>>({});
  const [catFilter, setCatFilter] = useState<string>(() => visibleTabs[0]?.key ?? '6');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>(profile?.equippedSkills[0] ?? 'skill_01');
  const [previewSkill, setPreviewSkill] = useState<{ id: string; name: string } | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [iconUris, setIconUris] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestedIconsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.key === catFilter)) {
      setCatFilter(visibleTabs[0].key);
    }
  }, [visibleTabs, catFilter]);

  useEffect(() => {
    loadGameData(serverUrl)
      .then((bundle) => setSkillsById(bundle.skillsById))
      .catch((err) => setNotice(String(err)))
      .finally(() => setLoading(false));
  }, [serverUrl]);

  const filteredOwnedSkills = useMemo(() => {
    if (!profile) return [];
    const q = search.trim().toLowerCase();
    return profile.ownedSkills
      .filter((sid) => {
        const def = skillsById[sid];
        if (String(def?.type ?? '') !== catFilter) return false;
        if (q && !(def?.name ?? sid).toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (skillsById[a]?.level ?? 1) - (skillsById[b]?.level ?? 1));
  }, [profile, skillsById, catFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredOwnedSkills.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedSkills = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredOwnedSkills.slice(start, start + PAGE_SIZE);
  }, [filteredOwnedSkills, safePage]);

  // Capture HD SWF icons for 8 equipped slots + visible page
  useEffect(() => {
    if (!bridgeReady || !profile) return;
    const neededIds = Array.from(new Set([...profile.equippedSkills, ...pagedSkills]));
    const missing = neededIds.filter(
      (sid) => Boolean(sid) && !iconUris[sid] && !requestedIconsRef.current.has(sid)
    );
    if (missing.length === 0) return;

    missing.forEach((sid) => requestedIconsRef.current.add(sid));
    for (let i = 0; i < missing.length; i += 12) {
      const chunk = missing.slice(i, i + 12);
      const url = buildIconSheetSwfUrl(serverUrl, 'skills', chunk.join(','));
      iconBridgeRef.current?.captureSkillIcons(url, chunk);
    }
  }, [bridgeReady, serverUrl, profile?.equippedSkills, pagedSkills, iconUris]);

  const handleBridgeEvent = (ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') setBridgeReady(true);
    else if (ev.type === 'SKILL_ICONS' && ev.icons) {
      setIconUris((prev) => ({ ...prev, ...ev.icons }));
    }
  };

  if (!profile) return null;

  const activeSkillId =
    (selectedId && profile.ownedSkills.includes(selectedId) ? selectedId : null) ??
    pagedSkills[0] ??
    profile.equippedSkills[0] ??
    null;
  const activeSkill = activeSkillId ? skillsById[activeSkillId] : undefined;
  const isEquipped = activeSkillId ? profile.equippedSkills.includes(activeSkillId) : false;
  const activeTabMeta = ALL_JUTSU_TABS.find(
    (t) => t.key === String(activeSkill?.type ?? catFilter)
  );

  const handleToggleEquip = async (skillId: string) => {
    if (!sessionKey) return;
    playClickSfx(serverUrl);
    const alreadyEq = profile.equippedSkills.includes(skillId);
    let nextSkills: string[];
    if (alreadyEq) {
      nextSkills = profile.equippedSkills.filter((id) => id !== skillId);
    } else {
      if (profile.equippedSkills.length >= 8) {
        setNotice('Maximum of 8 Jutsu can be equipped in the Battle Bar.');
        return;
      }
      nextSkills = [...profile.equippedSkills, skillId];
    }

    setBusyId(skillId);
    setNotice(null);
    try {
      await api.rpc(
        'CharacterService',
        'equipSkillSet',
        [profile.charId, sessionKey, nextSkills.join(',')],
        { sessionKey, charId: profile.charId }
      );
      const raw = await api.getCharacter(profile.charId, sessionKey);
      setProfileFromRaw(profile.charId, raw);
      setNotice(`Battle Loadout updated (${nextSkills.length}/8 Jutsu equipped).`);
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const handleUnequipAll = async () => {
    if (!sessionKey || profile.equippedSkills.length === 0 || busyId !== null) return;
    playClickSfx(serverUrl);
    setBusyId('__ALL__');
    setNotice(null);
    try {
      await api.rpc(
        'CharacterService',
        'equipSkillSet',
        [profile.charId, sessionKey, ''],
        { sessionKey, charId: profile.charId }
      );
      const raw = await api.getCharacter(profile.charId, sessionKey);
      setProfileFromRaw(profile.charId, raw);
      setNotice('All Jutsu unequipped (0/8).');
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <NinjaScrollWindow
      title="My Jutsu"
      bgSource={BUILDING_BGS.academy}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <View style={styles.loadoutBadge}>
          <Text style={styles.loadoutBadgeTxt}>
            Equipped: {profile.equippedSkills.length} / 8
          </Text>
        </View>
      }
    >
      <View style={styles.hiddenBridge} pointerEvents="none">
        <RuffleStageView ref={iconBridgeRef} baseUrl={serverUrl} onEvent={handleBridgeEvent} />
      </View>

      <NinjaToast message={notice} />

      <View style={styles.container}>

        {/* Top Strip: 8-Slot Equipped Battle Loadout Bar */}
        <View style={styles.equippedBar}>
          <Text style={styles.eqBarLabel}>BATTLE BAR</Text>
          <View style={styles.eqSlotsRow}>
            {EQUIP_SLOTS.map((slotIdx) => {
              const sid = profile.equippedSkills[slotIdx];
              const isSel = sid && sid === activeSkillId;
              return (
                <Pressable
                  key={slotIdx}
                  style={[styles.eqSlotBox, isSel && styles.eqSlotBoxActive]}
                  onPress={() => {
                    if (!sid) return;
                    playClickSfx(serverUrl);
                    setSelectedId(sid);
                  }}
                >
                  {sid ? (
                    iconUris[sid] ? (
                      <Image
                        source={{ uri: iconUris[sid] }}
                        style={styles.eqSlotImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={styles.fallbackIcon}>📜</Text>
                    )
                  ) : (
                    <Text style={styles.emptySlotNum}>{slotIdx + 1}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={[
              styles.unequipAllBtn,
              (profile.equippedSkills.length === 0 || busyId !== null) && styles.btnDisabled,
            ]}
            disabled={profile.equippedSkills.length === 0 || busyId !== null}
            onPress={handleUnequipAll}
          >
            <Text style={styles.unequipAllTxt}>
              {busyId === '__ALL__' ? 'Clearing...' : '✕ Unequip All'}
            </Text>
          </Pressable>
        </View>

        {/* Category Tabs + Search */}
        <View style={styles.topBarRow}>
          <ScrollView showsVerticalScrollIndicator={false}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabStrip}
            style={{ flex: 1 }}
          >
            {visibleTabs.map((t) => (
              <Pressable
                key={t.key}
                style={[styles.mainTabBtn, catFilter === t.key && styles.mainTabBtnActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setCatFilter(t.key);
                  setPage(1);
                }}
              >
                <Text style={[styles.mainTabTxt, catFilter === t.key && styles.mainTabTxtActive]}>
                  {t.icon} {t.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={(txt) => {
              setSearch(txt);
              setPage(1);
            }}
            placeholder="Search owned..."
            placeholderTextColor="#7A4C24"
          />
        </View>

        {/* Encyclopedia-Style Split Body */}
        <View style={styles.splitBody}>
          {/* Left: Paginated Owned Jutsu List */}
          <View style={styles.leftCol}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
              </View>
            ) : (
              <>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listWrap}>
                  {pagedSkills.length === 0 ? (
                    <Text style={styles.emptyTxt}>No Jutsu learned in this category yet.</Text>
                  ) : (
                    pagedSkills.map((sid) => {
                      const def = skillsById[sid];
                      const active = sid === activeSkillId;
                      const eq = profile.equippedSkills.includes(sid);
                      return (
                        <Pressable
                          key={sid}
                          style={[styles.tile, active && styles.tileActive]}
                          onPress={() => {
                            playClickSfx(serverUrl);
                            setSelectedId(sid);
                          }}
                        >
                          <View style={styles.tileIconBox}>
                            {iconUris[sid] ? (
                              <Image
                                source={{ uri: iconUris[sid] }}
                                style={styles.tileIconImg}
                                resizeMode="contain"
                              />
                            ) : (
                              <Text style={styles.fallbackIcon}>📜</Text>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.tileName} numberOfLines={1}>
                              {def?.name ?? sid}
                            </Text>
                            <Text style={styles.tileSub} numberOfLines={1}>
                              Lv.{def?.level ?? 1} • DMG {def?.damage ?? 0} • {def?.cp_cost ?? 0} CP
                              {eq ? ' • ★ EQUIPPED' : ''}
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
            )}
          </View>

          {/* Right: Clean Encyclopedia Detail Card */}
          <View style={styles.rightCol}>
            {activeSkillId ? (
              <View style={styles.detailCard}>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
                  <View style={styles.detailHeader}>
                    <View style={styles.detailIconBig}>
                      {iconUris[activeSkillId] ? (
                        <Image
                          source={{ uri: iconUris[activeSkillId] }}
                          style={styles.detailIconImg}
                          resizeMode="contain"
                        />
                      ) : (
                        <Text style={{ fontSize: 24 }}>📜</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailTitle}>{activeSkill?.name ?? activeSkillId}</Text>
                      <View
                        style={[
                          styles.typeBadge,
                          { backgroundColor: activeTabMeta?.color ?? '#B45309' },
                        ]}
                      >
                        <Text style={styles.typeBadgeTxt}>
                          {activeTabMeta?.icon} {activeTabMeta?.label} • Lv.{activeSkill?.level ?? 1}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      style={styles.previewBtn}
                      onPress={() => {
                        playClickSfx(serverUrl);
                        setPreviewSkill({
                          id: activeSkillId,
                          name: activeSkill?.name ?? activeSkillId,
                        });
                      }}
                    >
                      <Text style={styles.previewBtnTxt}>🎬 Preview</Text>
                    </Pressable>
                  </View>

                  <View style={styles.statChips}>
                    <Text style={styles.statChip}>⚔️ DMG: {activeSkill?.damage ?? 0}</Text>
                    <Text style={styles.statChip}>💧 CP: {activeSkill?.cp_cost ?? 0}</Text>
                    <Text style={styles.statChip}>⏱️ CD: {activeSkill?.cooldown ?? 0}t</Text>
                    <Text style={styles.statChip}>
                      🎯 {activeSkill && isSkillAoE(activeSkill) ? 'All Enemies' : 'Single'}
                    </Text>
                  </View>

                  <View style={styles.descBox}>
                    <Text style={styles.descHeading}>Description</Text>
                    <Text style={styles.descBody}>
                      {activeSkill?.description || 'Authentic shinobi jutsu.'}
                    </Text>
                  </View>
                </ScrollView>

                <Pressable
                  style={[
                    styles.actionBtn,
                    isEquipped ? styles.btnRed : styles.btnGreen,
                    busyId !== null && styles.btnDisabled,
                  ]}
                  disabled={busyId !== null}
                  onPress={() => handleToggleEquip(activeSkillId)}
                >
                  <Text style={styles.actionBtnTxt}>
                    {busyId === activeSkillId
                      ? 'Updating...'
                      : isEquipped
                      ? 'Unequip from Battle Bar'
                      : 'Equip to Battle Bar'}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.center}>
                <Text style={styles.emptyTxt}>Select a Jutsu to inspect or equip.</Text>
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
  loadoutBadge: {
    backgroundColor: '#3E2008',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  loadoutBadgeTxt: { color: '#FFE082', fontWeight: '800', fontSize: 11.5 },
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
  equippedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  eqBarLabel: { color: NS_THEME.inkMid, fontWeight: '900', fontSize: 9.5, letterSpacing: 0.5 },
  eqSlotsRow: { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'flex-start' },
  eqSlotBox: {
    width: 36,
    height: 36,
    borderRadius: 7,
    backgroundColor: '#231309',
    borderWidth: 1.5,
    borderColor: '#A16207',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  eqSlotBoxActive: { borderColor: '#FDE047', borderWidth: 2 },
  eqSlotImg: { width: '100%', height: '100%' },
  emptySlotNum: { color: '#78716C', fontWeight: '900', fontSize: 11 },
  unequipAllBtn: {
    backgroundColor: NS_THEME.btnRed,
    borderWidth: 1.5,
    borderColor: '#3E2008',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unequipAllTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 11 },
  topBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabStrip: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  mainTabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5.5,
    borderRadius: 8,
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
  },
  mainTabBtnActive: { backgroundColor: NS_THEME.tabActive, borderColor: '#FFE082' },
  mainTabTxt: { color: '#FFF4DC', fontWeight: '800', fontSize: 11.5 },
  mainTabTxtActive: { color: '#FFFFFF', fontWeight: '900' },
  searchInput: {
    width: 145,
    backgroundColor: '#FFF7E0',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    color: NS_THEME.inkDark,
    fontSize: 11.5,
    fontWeight: '700',
  },
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
  btnGreen: { backgroundColor: NS_THEME.btnGreen },
  btnRed: { backgroundColor: NS_THEME.btnRed },
  btnDisabled: { opacity: 0.45 },
});
