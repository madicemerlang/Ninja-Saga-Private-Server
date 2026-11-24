import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

type GearCategory = 'wpn' | 'set' | 'back' | 'hair' | 'accessory' | 'item';

const GEAR_CATEGORIES: Array<{ key: GearCategory; label: string; icon: string; color: string }> = [
  { key: 'wpn', label: 'Weapons', icon: '⚔️', color: '#B45309' },
  { key: 'set', label: 'Outfits', icon: '👘', color: '#0369A1' },
  { key: 'back', label: 'Back', icon: '🎒', color: '#6D28D9' },
  { key: 'hair', label: 'Hair', icon: '💇', color: '#BE185D' },
  { key: 'accessory', label: 'Accessory', icon: '💍', color: '#0F766E' },
  { key: 'item', label: 'Items', icon: '🧪', color: '#15803D' },
];

const SHOP_PAGE_SIZE = 24;

export function InventoryScreen() {
  const iconBridgeRef = useRef<RuffleStageHandle>(null);
  const previewStageRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [gearCat, setGearCat] = useState<GearCategory>('wpn');
  const [search, setSearch] = useState('');
  const [shopPage, setShopPage] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [showFittingRoom, setShowFittingRoom] = useState(false);
  const [tryOnAnim, setTryOnAnim] = useState<'standby' | 'attack_01'>('standby');

  const [libraryItems, setLibraryItems] = useState<LibraryItemDef[]>([]);
  const [itemsById, setItemsById] = useState<Record<string, LibraryItemDef>>({});
  const [loading, setLoading] = useState(true);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [iconUris, setIconUris] = useState<Record<string, string>>({});
  const requestedIconsRef = useRef<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lib = await loadLibraryData(serverUrl);
        if (!alive) return;
        setLibraryItems(lib.items);
        setItemsById(lib.itemsById);
      } catch (err) {
        if (alive) setNotice(`Failed to load Shop catalog: ${String(err)}`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [serverUrl]);

  const refreshProfile = useCallback(async () => {
    if (!profile || !sessionKey) return;
    const raw = await api.getCharacter(profile.charId, sessionKey);
    setProfileFromRaw(profile.charId, raw);
  }, [api, profile, sessionKey, setProfileFromRaw]);

  const ownedForCategory: string[] = useMemo(() => {
    if (!profile) return [];
    switch (gearCat) {
      case 'wpn':
        return profile.ownedWeapons;
      case 'set':
        return profile.ownedClothing;
      case 'back':
        return profile.ownedBackItems;
      case 'accessory':
        return profile.ownedAccessories;
      case 'hair':
        return profile.ownedHairs;
      case 'item':
        return [];
    }
  }, [profile, gearCat]);

  const equippedForCategory: string = useMemo(() => {
    if (!profile) return '';
    switch (gearCat) {
      case 'wpn':
        return profile.weapon;
      case 'set':
        return profile.clothing;
      case 'back':
        return profile.back;
      case 'accessory':
        return profile.accessory;
      case 'hair':
        return profile.hairStyle;
      case 'item':
        return '';
    }
  }, [profile, gearCat]);

  const displayedList: LibraryItemDef[] = useMemo(() => {
    if (!profile) return [];
    const gSuffix = profile.gender === 1 ? '_1' : '_0';
    const q = search.trim().toLowerCase();
    return libraryItems
      .filter((it) => {
        if (it.type !== gearCat) return false;
        if (!it.buyable) return false;
        if ((gearCat === 'set' || gearCat === 'hair') && !it.id.endsWith(gSuffix)) return false;
        if (q && !it.name.toLowerCase().includes(q) && !it.id.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.level - b.level || a.price_gold - b.price_gold || a.price_tokens - b.price_tokens);
  }, [libraryItems, gearCat, search, profile]);

  useEffect(() => {
    setShopPage(1);
    if (gearCat === 'accessory' || gearCat === 'item') {
      setShowFittingRoom(false);
    }
  }, [gearCat, search]);

  const totalShopPages = Math.max(1, Math.ceil(displayedList.length / SHOP_PAGE_SIZE));
  const safeShopPage = Math.min(shopPage, totalShopPages);
  const pagedList = useMemo(() => {
    const start = (safeShopPage - 1) * SHOP_PAGE_SIZE;
    return displayedList.slice(start, start + SHOP_PAGE_SIZE);
  }, [displayedList, safeShopPage]);

  const selectedItem = useMemo(
    () => pagedList.find((it) => it.id === selectedItemId) ?? pagedList[0] ?? null,
    [pagedList, selectedItemId]
  );

  // Capture HD SWF icons ONLY for the 24 items on the current page
  useEffect(() => {
    if (!bridgeReady || pagedList.length === 0) return;
    const sheetCat = gearCat === 'item' ? 'consumables' : 'items';
    const missing = pagedList
      .map((it) => it.id)
      .filter((id) => !iconUris[id] && !requestedIconsRef.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => requestedIconsRef.current.add(id));
    for (let i = 0; i < missing.length; i += 12) {
      const chunk = missing.slice(i, i + 12);
      const url = buildIconSheetSwfUrl(serverUrl, sheetCat, chunk.join(','));
      iconBridgeRef.current?.captureSkillIcons(url, chunk);
    }
  }, [bridgeReady, serverUrl, gearCat, pagedList, iconUris]);

  // Live Ruffle Fitting Room Popup Preview (Weapons, Outfits, Back, Hair only)
  useEffect(() => {
    if (!showFittingRoom || !profile || !selectedItem) return;
    if (gearCat === 'accessory' || gearCat === 'item') return;
    const t = setTimeout(() => {
      const overrides = {
        weapon: gearCat === 'wpn' ? selectedItem.id : profile.weapon,
        clothing: gearCat === 'set' ? selectedItem.id : profile.clothing,
        back: gearCat === 'back' ? selectedItem.id : profile.back,
        hair: gearCat === 'hair' ? selectedItem.id : profile.hairStyle,
      };
      const tag = `${overrides.hair}_${overrides.clothing}_${overrides.weapon}_${overrides.back}`;
      const url = buildPlayerSwfUrl(serverUrl, profile.charId, tryOnAnim, tag, overrides);
      previewStageRef.current?.loadSwf(url);
    }, 180);
    return () => clearTimeout(t);
  }, [showFittingRoom, profile, selectedItem, gearCat, tryOnAnim, serverUrl]);

  const handleBridgeEvent = (ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') setBridgeReady(true);
    else if (ev.type === 'SKILL_ICONS' && ev.icons) {
      setIconUris((prev) => ({ ...prev, ...ev.icons }));
    }
  };

  const handleBuyGear = async (item: LibraryItemDef) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(item.id);
    setNotice(null);
    try {
      const res = await api.rpc<Record<string, unknown>>(
        'CharacterService',
        'buyItem',
        [profile.charId, sessionKey, item.id, 1],
        { sessionKey, charId: profile.charId }
      );
      if ((res.data?.status as number) === 1) {
        setNotice(`Purchased ${item.name}!`);
        await refreshProfile();
      } else {
        setNotice(String(res.data?.result ?? res.data?.error ?? 'Purchase failed.'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const handleEquipGear = async (cat: GearCategory, itemId: string) => {
    if (!profile || !sessionKey || cat === 'item') return;
    playClickSfx(serverUrl);
    setBusyId(itemId);
    setNotice(null);
    try {
      const res = await api.rpc<Record<string, unknown>>(
        'CharacterService',
        'equipSet',
        [
          profile.charId,
          sessionKey,
          cat === 'wpn' ? itemId : profile.weapon,
          cat === 'back' ? itemId : profile.back,
          cat === 'set' ? itemId : profile.clothing,
          cat === 'accessory' ? itemId : profile.accessory,
          cat === 'hair' ? itemId : profile.hairStyle,
          profile.hairColor,
          profile.skinColor,
        ],
        { sessionKey, charId: profile.charId }
      );
      if ((res.data?.status as number) === 1) {
        await refreshProfile();
        setNotice(`Equipped ${itemsById[itemId]?.name ?? itemId}!`);
      } else {
        setNotice(String(res.data?.error ?? 'Failed to equip gear.'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  if (!profile) return null;

  const activeCatMeta = GEAR_CATEGORIES.find((c) => c.key === gearCat);
  const canTryOn = gearCat !== 'accessory' && gearCat !== 'item';

  return (
    <NinjaScrollWindow
      title="Shop"
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
      {/* Hidden 1x1 SWF Icon Capture Bridge */}
      <View style={styles.hiddenBridge} pointerEvents="none">
        <RuffleStageView ref={iconBridgeRef} baseUrl={serverUrl} onEvent={handleBridgeEvent} />
      </View>

      <NinjaToast message={notice} />

      <View style={styles.container}>

        {/* Top Bar: Category Tabs + Search */}
        <View style={styles.topBarRow}>
          <ScrollView showsVerticalScrollIndicator={false}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabStrip}
            style={{ flex: 1 }}
          >
            {GEAR_CATEGORIES.map((c) => (
              <Pressable
                key={c.key}
                style={[styles.mainTabBtn, gearCat === c.key && styles.mainTabBtnActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setGearCat(c.key);
                }}
              >
                <Text style={[styles.mainTabTxt, gearCat === c.key && styles.mainTabTxtActive]}>
                  {c.icon} {c.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search shop..."
            placeholderTextColor="#7A4C24"
          />
        </View>

        {/* Encyclopedia Split View */}
        <View style={styles.splitBody}>
          {/* Left: Paginated Uniform Item List */}
          <View style={styles.leftCol}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
              </View>
            ) : (
              <>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listWrap}>
                  {pagedList.length === 0 ? (
                    <Text style={styles.emptyTxt}>No items in this category.</Text>
                  ) : (
                    pagedList.map((it) => {
                      const active = selectedItem?.id === it.id;
                      const owned = ownedForCategory.includes(it.id);
                      const equipped = equippedForCategory === it.id;
                      const priceStr =
                        it.price_tokens > 0
                          ? `💎 ${it.price_tokens.toLocaleString()}T`
                          : `🪙 ${it.price_gold.toLocaleString()}G`;
                      return (
                        <Pressable
                          key={it.id}
                          style={[styles.tile, active && styles.tileActive]}
                          onPress={() => {
                            playClickSfx(serverUrl);
                            setSelectedItemId(it.id);
                          }}
                        >
                          <View style={styles.tileIconBox}>
                            {iconUris[it.id] ? (
                              <Image
                                source={{ uri: iconUris[it.id] }}
                                style={styles.tileIconImg}
                                resizeMode="contain"
                              />
                            ) : (
                              <Text style={styles.fallbackIcon}>{activeCatMeta?.icon ?? '⚔️'}</Text>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.tileName} numberOfLines={1}>
                              {it.name}
                            </Text>
                            <Text style={styles.tileSub} numberOfLines={1}>
                              Lv.{it.level} • {priceStr}
                              {equipped ? ' • ★ EQUIPPED' : owned && gearCat !== 'item' ? ' • ✓ OWNED' : ''}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>

                {totalShopPages > 1 ? (
                  <View style={styles.pageBar}>
                    <Pressable
                      style={[styles.pageBtn, safeShopPage <= 1 && styles.btnDisabled]}
                      disabled={safeShopPage <= 1}
                      onPress={() => {
                        playClickSfx(serverUrl);
                        setShopPage((p) => Math.max(1, p - 1));
                      }}
                    >
                      <Text style={styles.pageBtnTxt}>◀ Prev</Text>
                    </Pressable>
                    <Text style={styles.pageInfo}>
                      Page {safeShopPage} / {totalShopPages}
                    </Text>
                    <Pressable
                      style={[styles.pageBtn, safeShopPage >= totalShopPages && styles.btnDisabled]}
                      disabled={safeShopPage >= totalShopPages}
                      onPress={() => {
                        playClickSfx(serverUrl);
                        setShopPage((p) => Math.min(totalShopPages, p + 1));
                      }}
                    >
                      <Text style={styles.pageBtnTxt}>Next ▶</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </View>

          {/* Right: Clean Encyclopedia Detail Card + Optional Live Try-On */}
          <View style={styles.rightCol}>
            {selectedItem ? (() => {
              const owned = ownedForCategory.includes(selectedItem.id);
              const equipped = equippedForCategory === selectedItem.id;
              const levelOk = profile.level >= selectedItem.level;
              return (
                <View style={styles.detailCard}>
                  <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
                    <View style={styles.detailHeader}>
                      <View style={styles.detailIconBig}>
                        {iconUris[selectedItem.id] ? (
                          <Image
                            source={{ uri: iconUris[selectedItem.id] }}
                            style={styles.detailIconImg}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={{ fontSize: 24 }}>{activeCatMeta?.icon ?? '⚔️'}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailTitle}>{selectedItem.name}</Text>
                        <View
                          style={[
                            styles.typeBadge,
                            { backgroundColor: activeCatMeta?.color ?? '#B45309' },
                          ]}
                        >
                          <Text style={styles.typeBadgeTxt}>
                            {activeCatMeta?.icon} {activeCatMeta?.label} • Lv.{selectedItem.level}
                          </Text>
                        </View>
                      </View>
                      {canTryOn ? (
                        <Pressable
                          style={styles.tryBtn}
                          onPress={() => {
                            playClickSfx(serverUrl);
                            setTryOnAnim('standby');
                            setShowFittingRoom(true);
                          }}
                        >
                          <Text style={styles.tryBtnTxt}>👤 Try On</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    <View style={styles.statChips}>
                      {selectedItem.damage > 0 ? (
                        <Text style={styles.statChip}>⚔️ DMG: {selectedItem.damage}</Text>
                      ) : null}
                      <Text style={styles.statChip}>Req Lv.{selectedItem.level}</Text>
                      {selectedItem.price_tokens > 0 ? (
                        <Text style={styles.statChip}>
                          💎 {selectedItem.price_tokens.toLocaleString()} Tokens
                        </Text>
                      ) : (
                        <Text style={styles.statChip}>
                          🪙 {selectedItem.price_gold.toLocaleString()} Gold
                        </Text>
                      )}
                    </View>

                    <View style={styles.descBox}>
                      <Text style={styles.descHeading}>Description</Text>
                      <Text style={styles.descBody}>
                        {selectedItem.description || 'Authentic shinobi shop item.'}
                      </Text>
                    </View>
                  </ScrollView>

                  {owned && gearCat !== 'item' ? (
                    <Pressable
                      style={[
                        styles.actionBtn,
                        equipped ? styles.btnGreen : styles.btnBlue,
                        (equipped || busyId !== null) && styles.btnDisabled,
                      ]}
                      disabled={equipped || busyId !== null}
                      onPress={() => handleEquipGear(gearCat, selectedItem.id)}
                    >
                      <Text style={styles.actionBtnTxt}>
                        {busyId === selectedItem.id
                          ? 'Equipping...'
                          : equipped
                          ? '★ Equipped'
                          : 'Equip Item'}
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
                      onPress={() => handleBuyGear(selectedItem)}
                    >
                      <Text style={styles.actionBtnTxt}>
                        {busyId === selectedItem.id
                          ? 'Buying...'
                          : !levelOk
                          ? `Requires Level ${selectedItem.level}`
                          : selectedItem.price_tokens > 0
                          ? `Buy (${selectedItem.price_tokens.toLocaleString()} Tokens)`
                          : `Buy (${selectedItem.price_gold.toLocaleString()} Gold)`}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })() : (
              <View style={styles.center}>
                <Text style={styles.emptyTxt}>Select an item to view details.</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Try On Popup Modal */}
      <Modal
        visible={showFittingRoom && canTryOn && selectedItem !== null}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => setShowFittingRoom(false)}
      >
        <Pressable style={styles.tryModalBackdrop} onPress={() => setShowFittingRoom(false)}>
          <Pressable style={styles.tryModalCard} onPress={() => {}}>
            <View style={styles.tryModalHeader}>
              <Text style={styles.tryModalTitle} numberOfLines={1}>
                👤 Try On — {selectedItem?.name ?? ''}
              </Text>
              <View style={styles.tryAnimRow}>
                <Pressable
                  style={[styles.tryAnimBtn, tryOnAnim === 'standby' && styles.tryAnimBtnActive]}
                  onPress={() => setTryOnAnim('standby')}
                >
                  <Text style={styles.tryAnimTxt}>Standby</Text>
                </Pressable>
                <Pressable
                  style={[styles.tryAnimBtn, tryOnAnim === 'attack_01' && styles.tryAnimBtnActive]}
                  onPress={() => setTryOnAnim('attack_01')}
                >
                  <Text style={styles.tryAnimTxt}>Attack</Text>
                </Pressable>
              </View>
              <Pressable style={styles.tryModalClose} onPress={() => setShowFittingRoom(false)}>
                <Text style={styles.tryModalCloseTxt}>✕</Text>
              </Pressable>
            </View>
            <View style={styles.tryModalStage}>
              {showFittingRoom ? (
                <RuffleStageView ref={previewStageRef} baseUrl={serverUrl} />
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  tabStrip: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  mainTabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
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
  catRow: { flexDirection: 'row', gap: 5 },
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
  tryBtn: {
    backgroundColor: NS_THEME.btnBlue,
    borderWidth: 1.5,
    borderColor: '#FFE082',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tryBtnActive: { backgroundColor: NS_THEME.btnRed },
  tryBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 11 },
  tryModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  tryModalCard: {
    width: 390,
    maxWidth: '94%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorderDark,
    padding: 10,
    gap: 8,
  },
  tryModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tryModalTitle: { flex: 1, color: NS_THEME.inkDark, fontSize: 13, fontWeight: '900' },
  tryAnimRow: { flexDirection: 'row', gap: 4 },
  tryAnimBtn: {
    backgroundColor: NS_THEME.tabInactive,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tryAnimBtnActive: { backgroundColor: NS_THEME.btnOrange },
  tryAnimTxt: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  tryModalClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NS_THEME.btnRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tryModalCloseTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  tryModalStage: {
    width: '100%',
    height: 245,
    backgroundColor: NS_THEME.stageDark,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    overflow: 'hidden',
  },
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
  btnBlue: { backgroundColor: NS_THEME.btnBlue },
  btnDisabled: { opacity: 0.45 },
});
