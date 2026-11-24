import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MobileApiClient } from '../api/client';
import { loadLibraryData, type LibraryItemDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
import { buildIconSheetSwfUrl, buildPlayerSwfUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

type BagCategory = 'wpn' | 'set' | 'back' | 'accessory' | 'hair' | 'item' | 'material';

const BAG_TABS: Array<{ key: BagCategory; icon: string; label: string }> = [
  { key: 'wpn', icon: '⚔️', label: 'Weapons' },
  { key: 'set', icon: '👘', label: 'Outfits' },
  { key: 'back', icon: '🎒', label: 'Back' },
  { key: 'accessory', icon: '💍', label: 'Accessory' },
  { key: 'hair', icon: '💇', label: 'Hair' },
  { key: 'item', icon: '📜', label: 'Items' },
  { key: 'material', icon: '🧱', label: 'Materials' },
];

const HAIR_COLORS = [
  { label: 'Black', hex: '#1E293B', code: '0|0' },
  { label: 'Crimson', hex: '#DC2626', code: '14423100|0' },
  { label: 'Gold', hex: '#FACC15', code: '16435989|0' },
  { label: 'Azure', hex: '#2563EB', code: '2450411|0' },
  { label: 'Silver', hex: '#E2E8F0', code: '14870768|0' },
  { label: 'Violet', hex: '#7C3AED', code: '8141549|0' },
  { label: 'Emerald', hex: '#10B981', code: '1096065|0' },
  { label: 'Chestnut', hex: '#92400E', code: '9584654|0' },
];

export function MyInventoryScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [cat, setCat] = useState<BagCategory>('wpn');
  const [itemsById, setItemsById] = useState<Record<string, LibraryItemDef>>({});
  const [gearPage, setGearPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>(() => profile?.weapon ?? '');
  const [draftHairColor, setDraftHairColor] = useState<string>(() => profile?.hairColor || '0|0');
  const [inspectedEntry, setInspectedEntry] = useState<{ id: string; qty?: number } | null>(null);
  const [previewAnim, setPreviewAnim] = useState<'standby' | 'attack_01'>('standby');
  const [bridgeReady, setBridgeReady] = useState(false);
  const [iconUris, setIconUris] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);
  const lastLoadedUrlRef = useRef<string>('');
  const requestedIconsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    loadLibraryData(serverUrl)
      .then((lib) => setItemsById(lib.itemsById ?? {}))
      .catch((err) => setNotice(String(err)))
      .finally(() => setLoading(false));
  }, [serverUrl]);

  const getEntriesForCat = (targetCat: BagCategory): Array<{ id: string; qty?: number }> => {
    if (!profile) return [];
    if (targetCat === 'wpn') return profile.ownedWeapons.map((id) => ({ id }));
    if (targetCat === 'set') return profile.ownedClothing.map((id) => ({ id }));
    if (targetCat === 'back') return profile.ownedBackItems.map((id) => ({ id }));
    if (targetCat === 'accessory') return profile.ownedAccessories.map((id) => ({ id }));
    if (targetCat === 'hair') return profile.ownedHairs.map((id) => ({ id }));
    if (targetCat === 'item') return Object.entries(profile.ownedItems).map(([id, qty]) => ({ id, qty }));
    return Object.entries(profile.ownedMaterials).map(([id, qty]) => ({ id, qty }));
  };

  const getEquippedForCat = (targetCat: BagCategory): string => {
    if (!profile) return '';
    if (targetCat === 'wpn') return profile.weapon;
    if (targetCat === 'set') return profile.clothing;
    if (targetCat === 'back') return profile.back;
    if (targetCat === 'accessory') return profile.accessory;
    if (targetCat === 'hair') return profile.hairStyle;
    return '';
  };

  const ownedEntries = useMemo<Array<{ id: string; qty?: number }>>(() => {
    return getEntriesForCat(cat);
  }, [profile, cat]);

  const activeEquippedId = useMemo(() => {
    return getEquippedForCat(cat);
  }, [profile, cat]);

  const handleSelectTab = (nextCat: BagCategory) => {
    playClickSfx(serverUrl);
    const nextEntries = getEntriesForCat(nextCat);
    const nextEq = getEquippedForCat(nextCat);
    const nextSel =
      nextEq && nextEntries.some((e) => e.id === nextEq)
        ? nextEq
        : (nextEntries[0]?.id ?? '');
    setCat(nextCat);
    setSelectedId(nextSel);
  };

  useEffect(() => {
    if (profile?.hairColor) {
      setDraftHairColor(profile.hairColor);
    }
  }, [profile?.hairColor]);

  // Canonical preview URL helper (uses ONLY effective visual gear so Equip never causes a redundant reload!)
  const buildCanonicalPreviewUrl = (
    overrideCat: BagCategory,
    overrideItemId: string,
    anim: 'standby' | 'attack_01',
    overrideHairColor?: string
  ): string => {
    if (!profile) return '';
    const effWeapon =
      overrideCat === 'wpn' && overrideItemId.startsWith('wpn_') ? overrideItemId : profile.weapon;
    const effClothing =
      overrideCat === 'set' && overrideItemId.startsWith('set_') ? overrideItemId : profile.clothing;
    const effBack =
      overrideCat === 'back' && overrideItemId.startsWith('back_') ? overrideItemId : profile.back;
    const effHair =
      overrideCat === 'hair' && overrideItemId.startsWith('hair_') ? overrideItemId : profile.hairStyle;
    const effHairColor =
      overrideCat === 'hair' ? (overrideHairColor ?? draftHairColor) : profile.hairColor;

    const tag = `${effHair}_${effHairColor}_${effClothing}_${effWeapon}_${effBack}_${anim}`;
    return buildPlayerSwfUrl(serverUrl, profile.charId, anim, tag, {
      weapon: effWeapon,
      clothing: effClothing,
      back: effBack,
      hair: effHair,
      hairColor: effHairColor,
    });
  };

  const GEAR_PAGE_SIZE = 24;

  useEffect(() => {
    setGearPage(1);
  }, [cat]);

  const totalGearPages = Math.max(1, Math.ceil(ownedEntries.length / GEAR_PAGE_SIZE));
  const safeGearPage = Math.min(gearPage, totalGearPages);
  const pagedEntries = useMemo(() => {
    const start = (safeGearPage - 1) * GEAR_PAGE_SIZE;
    return ownedEntries.slice(start, start + GEAR_PAGE_SIZE);
  }, [ownedEntries, safeGearPage]);

  useEffect(() => {
    if (pagedEntries.length > 0) {
      const exists = pagedEntries.some((e) => e.id === selectedId);
      if (!exists) {
        setSelectedId(
          activeEquippedId && pagedEntries.some((e) => e.id === activeEquippedId)
            ? activeEquippedId
            : pagedEntries[0].id
        );
      }
    } else if (selectedId !== '') {
      setSelectedId('');
    }
  }, [pagedEntries, activeEquippedId, selectedId]);

  // Live 36 FPS character preview (skips reload if the exact visual gear is already on stage!)
  useEffect(() => {
    if (!profile || !bridgeReady) return;
    const url = buildCanonicalPreviewUrl(cat, selectedId, previewAnim, draftHairColor);
    if (!url || url === lastLoadedUrlRef.current) return;
    lastLoadedUrlRef.current = url;
    stageRef.current?.loadSwf(url);
  }, [serverUrl, profile, bridgeReady, cat, selectedId, previewAnim, draftHairColor]);

  // Background-preload up to 8 owned gear preview SWFs on current page for instant 0ms switching!
  useEffect(() => {
    if (!profile || !bridgeReady) return;
    if (cat === 'material' || cat === 'item' || cat === 'accessory' || pagedEntries.length <= 1) return;
    const timer = setTimeout(() => {
      const urls = pagedEntries
        .slice(0, 8)
        .map((e) => buildCanonicalPreviewUrl(cat, e.id, previewAnim))
        .filter((u) => Boolean(u) && u !== lastLoadedUrlRef.current);
      if (urls.length > 0) {
        stageRef.current?.preloadSwfs(urls);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [serverUrl, profile, bridgeReady, cat, pagedEntries, previewAnim]);

  // Capture authentic SWF gear icons ONLY for the current page (max 24 = 2 fast batches)
  useEffect(() => {
    if (!bridgeReady || pagedEntries.length === 0) return;
    const missing = pagedEntries
      .map((e) => e.id)
      .filter((id) => !iconUris[id] && !requestedIconsRef.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => requestedIconsRef.current.add(id));
    const sheetCat = cat === 'material' ? 'materials' : cat === 'item' ? 'consumables' : 'items';
    for (let i = 0; i < missing.length; i += 12) {
      const chunk = missing.slice(i, i + 12);
      const url = buildIconSheetSwfUrl(serverUrl, sheetCat, chunk.join(','));
      stageRef.current?.captureSkillIcons(url, chunk);
    }
  }, [bridgeReady, serverUrl, cat, pagedEntries, iconUris]);

  const handleStageEvent = (ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') {
      setBridgeReady(true);
    } else if (ev.type === 'SKILL_ICONS' && ev.icons) {
      setIconUris((prev) => ({ ...prev, ...ev.icons }));
    }
  };

  if (!profile) return null;

  const isSelectedEquipped = Boolean(
    selectedId &&
      selectedId === activeEquippedId &&
      (cat !== 'hair' || draftHairColor === profile.hairColor)
  );
  const currentTabMeta = BAG_TABS.find((t) => t.key === cat) ?? BAG_TABS[0];
  const inspectedMeta = inspectedEntry ? itemsById[inspectedEntry.id] : undefined;

  const handleEquip = async (itemId: string) => {
    if (!sessionKey || cat === 'material') return;
    playClickSfx(serverUrl);
    setBusyId(itemId);
    setNotice(null);
    try {
      const nextWeapon = cat === 'wpn' ? itemId : profile.weapon;
      const nextBack = cat === 'back' ? itemId : profile.back;
      const nextClothing = cat === 'set' ? itemId : profile.clothing;
      const nextAccessory = cat === 'accessory' ? itemId : profile.accessory;
      const nextHair = cat === 'hair' ? itemId : profile.hairStyle;

      const res = await api.rpc<Record<string, unknown>>(
        'CharacterService',
        'equipSet',
        [
          profile.charId,
          sessionKey,
          nextWeapon,
          nextBack,
          nextClothing,
          nextAccessory,
          nextHair,
          cat === 'hair' ? draftHairColor : profile.hairColor,
          profile.skinColor,
        ],
        { sessionKey, charId: profile.charId }
      );
      if ((res.data?.status as number) === 1) {
        const raw = await api.getCharacter(profile.charId, sessionKey);
        setProfileFromRaw(profile.charId, raw);
      } else {
        setNotice(String(res.data?.error ?? 'Failed to equip gear.'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <NinjaScrollWindow
      title="Gear"
      bgSource={BUILDING_BGS.ninjaShop}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <View style={styles.currencyPill}>
          <Text style={styles.currencyTxt}>
            🪙 {profile.gold.toLocaleString()} • 💎 {profile.tokens.toLocaleString()}
          </Text>
        </View>
      }
    >
      <NinjaToast message={notice} />

      {/* Category Tabs */}
      <ScrollView showsVerticalScrollIndicator={false}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsRow}
      >
        {BAG_TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tabChip, cat === t.key && styles.tabChipActive]}
            onPress={() => handleSelectTab(t.key)}
          >
            <Text style={[styles.tabTxt, cat === t.key && styles.tabTxtActive]}>
              {t.icon} {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.body}>
        {/* Left: Enlarged Live 36 FPS Character Fitting Room (no description below) */}
        <View style={styles.previewPane}>
          <View style={styles.stageBox}>
            <RuffleStageView ref={stageRef} baseUrl={serverUrl} onEvent={handleStageEvent} />
            <View style={styles.animToggleRow}>
              <Pressable
                style={[styles.animBtn, previewAnim === 'standby' && styles.animBtnOn]}
                onPress={() => setPreviewAnim('standby')}
              >
                <Text style={styles.animBtnTxt}>Idle</Text>
              </Pressable>
              <Pressable
                style={[styles.animBtn, previewAnim === 'attack_01' && styles.animBtnOn]}
                onPress={() => setPreviewAnim('attack_01')}
              >
                <Text style={styles.animBtnTxt}>Attack</Text>
              </Pressable>
            </View>
          </View>

          {cat !== 'material' && cat !== 'item' && selectedId ? (
            <Pressable
              style={[styles.equipBtn, isSelectedEquipped && styles.equippedBtn]}
              disabled={isSelectedEquipped || busyId !== null}
              onPress={() => handleEquip(selectedId)}
            >
              <Text style={styles.equipBtnTxt}>
                {busyId === selectedId
                  ? 'Equipping...'
                  : isSelectedEquipped
                    ? '★ Equipped'
                    : '✓ Equip'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Right: Owned Gear Grid with Authentic SWF Icons + Tap & Hold Inspector */}
        <View style={styles.gridPane}>
          {cat === 'hair' ? (
            <View style={styles.hairColorBar}>
              <Text style={styles.hairColorLabel}>Hair Color:</Text>
              <View style={styles.swatchRow}>
                {HAIR_COLORS.map((hc) => (
                  <Pressable
                    key={hc.label}
                    style={[
                      styles.swatch,
                      { backgroundColor: hc.hex },
                      draftHairColor === hc.code && styles.swatchActive,
                    ]}
                    onPress={() => {
                      playClickSfx(serverUrl);
                      setDraftHairColor(hc.code);
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <Text style={styles.sectionTitle}>
            {currentTabMeta.label} ({ownedEntries.length}) — Tap: Preview • Hold: Info
          </Text>
          {loading ? (
            <ActivityIndicator color={NS_THEME.btnOrange} style={{ marginTop: 20 }} />
          ) : ownedEntries.length === 0 ? (
            <Text style={styles.emptyTxt}>
              No items in this category yet. Visit the Shop or Hunting House!
            </Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.grid}>
              {pagedEntries.map(({ id, qty }) => {
                const meta = itemsById[id];
                const isEq = id === activeEquippedId;
                const isSel = id === selectedId;
                const iconUri = iconUris[id];
                return (
                  <Pressable
                    key={id}
                    delayLongPress={280}
                    style={[
                      styles.itemCard,
                      isEq && styles.itemCardEq,
                      isSel && styles.itemCardSel,
                    ]}
                    onPress={() => {
                      playClickSfx(serverUrl);
                      setSelectedId(id);
                    }}
                    onLongPress={() => {
                      playClickSfx(serverUrl);
                      setSelectedId(id);
                      setInspectedEntry({ id, qty });
                    }}
                  >
                    {iconUri ? (
                      <Image source={{ uri: iconUri }} style={styles.iconImg} resizeMode="cover" />
                    ) : (
                      <Text style={styles.iconFallback}>{currentTabMeta.icon}</Text>
                    )}
                    {cat !== 'material' ? (
                      <View style={styles.lvBadge}>
                        <Text style={styles.lvBadgeTxt}>Lv.{meta?.level ?? 1}</Text>
                      </View>
                    ) : null}
                    {isEq ? (
                      <View style={styles.eqBadge}>
                        <Text style={styles.eqBadgeTxt}>★</Text>
                      </View>
                    ) : null}
                    {cat === 'material' || cat === 'item' ? (
                      <View style={styles.qtyBadge}>
                        <Text style={styles.qtyBadgeTxt}>x{qty ?? 1}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {totalGearPages > 1 ? (
            <View style={styles.pageBar}>
              <Pressable
                style={[styles.pageBtn, safeGearPage <= 1 && styles.btnDisabled]}
                disabled={safeGearPage <= 1}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setGearPage((p) => Math.max(1, p - 1));
                }}
              >
                <Text style={styles.pageBtnTxt}>◀ Prev</Text>
              </Pressable>
              <Text style={styles.pageInfo}>
                Page {safeGearPage} / {totalGearPages}
              </Text>
              <Pressable
                style={[styles.pageBtn, safeGearPage >= totalGearPages && styles.btnDisabled]}
                disabled={safeGearPage >= totalGearPages}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setGearPage((p) => Math.min(totalGearPages, p + 1));
                }}
              >
                <Text style={styles.pageBtnTxt}>Next ▶</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>

      {/* Tap & Hold Gear Inspector Modal */}
      <Modal
        visible={inspectedEntry !== null}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => setInspectedEntry(null)}
      >
        <Pressable style={styles.inspectorBackdrop} onPress={() => setInspectedEntry(null)}>
          {inspectedEntry ? (
            <Pressable style={styles.inspectorCard} onPress={() => {}}>
              <View style={styles.inspectorHeader}>
                <View style={styles.inspectorIconBox}>
                  {iconUris[inspectedEntry.id] ? (
                    <Image
                      source={{ uri: iconUris[inspectedEntry.id] }}
                      style={styles.iconImg}
                      resizeMode="contain"
                    />
                  ) : (
                    <Text style={styles.inspectorIconFallback}>{currentTabMeta.icon}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inspectorTitle} numberOfLines={2}>
                    {inspectedMeta?.name ?? inspectedEntry.id}
                  </Text>
                  <Text style={styles.inspectorSub}>
                    {currentTabMeta.label}
                    {cat === 'material'
                      ? ` • Qty: x${inspectedEntry.qty ?? 1}`
                      : ` • Lv.${inspectedMeta?.level ?? 1}${inspectedMeta?.damage ? ` • DMG ${inspectedMeta.damage}` : ''}`}
                  </Text>
                </View>
                <Pressable
                  style={styles.inspectorCloseBtn}
                  onPress={() => setInspectedEntry(null)}
                >
                  <Text style={styles.inspectorCloseTxt}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.inspectorDescBox}>
                <Text style={styles.inspectorDesc}>
                  {inspectedMeta?.description || 'Authentic shinobi gear.'}
                </Text>
              </View>

              {cat !== 'material' ? (
                <Pressable
                  style={[
                    styles.equipBtn,
                    inspectedEntry.id === activeEquippedId && styles.equippedBtn,
                  ]}
                  disabled={inspectedEntry.id === activeEquippedId || busyId !== null}
                  onPress={() => {
                    const targetId = inspectedEntry.id;
                    setInspectedEntry(null);
                    handleEquip(targetId);
                  }}
                >
                  <Text style={styles.equipBtnTxt}>
                    {inspectedEntry.id === activeEquippedId
                      ? '★ Equipped'
                      : '✓ Equip'}
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  currencyPill: {
    backgroundColor: '#3E2008',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  currencyTxt: { color: '#FDE047', fontSize: 10.5, fontWeight: '900' },
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
  tabsScroll: { maxHeight: 34, marginBottom: 6 },
  tabsRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  tabChip: {
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tabChipActive: { backgroundColor: NS_THEME.tabActive, borderColor: NS_THEME.woodBorderDark },
  tabTxt: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900' },
  tabTxtActive: { color: '#FFF' },
  body: { flex: 1, flexDirection: 'row', gap: 8 },
  previewPane: {
    width: '38%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 6,
    gap: 6,
  },
  stageBox: {
    flex: 1,
    backgroundColor: NS_THEME.stageDark,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    overflow: 'hidden',
    position: 'relative',
  },
  animToggleRow: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    gap: 4,
  },
  animBtn: {
    backgroundColor: 'rgba(62, 32, 8, 0.88)',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: NS_THEME.goldTrim,
  },
  animBtnOn: { backgroundColor: NS_THEME.btnOrange, borderColor: '#FDE047' },
  animBtnTxt: { color: '#FFF', fontSize: 9, fontWeight: '900' },
  equipBtn: {
    backgroundColor: NS_THEME.btnGreen,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    borderRadius: 7,
    paddingVertical: 6,
    alignItems: 'center',
  },
  equippedBtn: { backgroundColor: NS_THEME.btnBlue, opacity: 0.85 },
  equipBtnTxt: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  gridPane: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
  },
  sectionTitle: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900', marginBottom: 6 },
  hairColorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 7,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 6,
  },
  hairColorLabel: { color: NS_THEME.inkDark, fontSize: 10, fontWeight: '900' },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
  },
  swatchActive: { borderColor: '#FACC15', borderWidth: 2.5, transform: [{ scale: 1.15 }] },
  emptyTxt: { color: NS_THEME.inkMid, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 14 },
  itemCard: {
    width: '18.2%',
    aspectRatio: 1,
    backgroundColor: NS_THEME.stageDark,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorder,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  itemCardEq: { borderColor: NS_THEME.btnGreen },
  itemCardSel: { borderColor: NS_THEME.btnOrange, borderWidth: 2.5 },
  iconImg: { width: '100%', height: '100%' },
  iconFallback: { fontSize: 22 },
  lvBadge: {
    position: 'absolute',
    top: 2,
    left: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  lvBadgeTxt: { color: '#FDE047', fontSize: 8, fontWeight: '900' },
  eqBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#15803D',
    borderRadius: 4,
    paddingHorizontal: 3,
  },
  eqBadgeTxt: { color: '#FDE047', fontSize: 9, fontWeight: '900' },
  qtyBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 4,
    paddingHorizontal: 3,
  },
  qtyBadgeTxt: { color: '#FDE047', fontSize: 8.5, fontWeight: '900' },
  inspectorBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  inspectorCard: {
    width: 340,
    maxWidth: '92%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorderDark,
    padding: 12,
    gap: 10,
  },
  inspectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inspectorIconBox: {
    width: 56,
    height: 56,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorder,
    backgroundColor: NS_THEME.stageDark,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspectorIconFallback: { fontSize: 26 },
  inspectorTitle: { color: NS_THEME.inkDark, fontSize: 13.5, fontWeight: '900' },
  inspectorSub: { color: '#9A3412', fontSize: 10.5, fontWeight: '800', marginTop: 2 },
  inspectorCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NS_THEME.btnRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspectorCloseTxt: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  inspectorDescBox: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
    padding: 10,
  },
  inspectorDesc: {
    color: NS_THEME.inkDark,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
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
    marginTop: 4,
  },
  pageBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pageBtnTxt: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '900' },
  pageInfo: { color: NS_THEME.inkDark, fontSize: 11, fontWeight: '800' },
  btnDisabled: { opacity: 0.4 },
});
