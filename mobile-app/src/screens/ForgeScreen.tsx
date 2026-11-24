import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MobileApiClient, type BlacksmithRecipeDef } from '../api/client';
import { loadLibraryData, type LibraryItemDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
import { buildIconSheetSwfUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

const MAGATAMA_IDS = [
  'material_01',
  'material_02',
  'material_03',
  'material_04',
  'material_05',
  'material_06',
] as const;

const PAGE_SIZE = 24;

export function ForgeScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const iconBridgeRef = useRef<RuffleStageHandle>(null);
  const requestedIconsRef = useRef<Set<string>>(new Set());
  const [bridgeReady, setBridgeReady] = useState(false);
  const [iconUris, setIconUris] = useState<Record<string, string>>({});
  const [recipes, setRecipes] = useState<Record<string, BlacksmithRecipeDef>>({});
  const [itemsById, setItemsById] = useState<Record<string, LibraryItemDef>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2000);
    return () => clearTimeout(t);
  }, [message]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [feat, lib] = await Promise.all([api.getFeatureData(), loadLibraryData(serverUrl)]);
      setRecipes(feat.blacksmith_recipes ?? {});
      setItemsById(lib.itemsById ?? {});
    } catch (err) {
      setMessage(`Failed to load Blacksmith: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, serverUrl]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const ownedWeapons = useMemo(() => new Set(profile?.ownedWeapons ?? []), [profile?.ownedWeapons]);
  const ownedMats = profile?.ownedMaterials ?? {};

  const handleForge = async (weaponId: string, currency: 'gold' | 'tokens') => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(`${weaponId}-${currency}`);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'BlacksmithService',
        'forgeItem',
        [profile.charId, sessionKey, weaponId, currency],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage(`Forged ${itemsById[weaponId]?.name ?? weaponId}!`);
        const raw = await api.getCharacter(profile.charId, sessionKey);
        setProfileFromRaw(profile.charId, raw);
      } else {
        setMessage(res.data?.result || res.data?.error || 'Failed to forge item.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const entries = useMemo(() => {
    return Object.entries(recipes).sort(
      ([idA], [idB]) => (itemsById[idA]?.level ?? 1) - (itemsById[idB]?.level ?? 1)
    );
  }, [recipes, itemsById]);

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedEntries = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return entries.slice(start, start + PAGE_SIZE);
  }, [entries, safePage]);

  const selectedEntry = useMemo(() => {
    const found = pagedEntries.find(([id]) => id === selectedId);
    return found ?? pagedEntries[0] ?? null;
  }, [pagedEntries, selectedId]);

  // Capture Magatama icons + current page weapon icons
  useEffect(() => {
    if (!bridgeReady) return;
    const missingMags = MAGATAMA_IDS.filter(
      (id) => !iconUris[id] && !requestedIconsRef.current.has(id)
    );
    if (missingMags.length > 0) {
      missingMags.forEach((id) => requestedIconsRef.current.add(id));
      const magUrl = buildIconSheetSwfUrl(serverUrl, 'materials', missingMags.join(','));
      iconBridgeRef.current?.captureSkillIcons(magUrl, missingMags);
    }

    const missingWpns = pagedEntries
      .map(([id]) => id)
      .filter((id) => !iconUris[id] && !requestedIconsRef.current.has(id));
    if (missingWpns.length === 0) return;

    missingWpns.forEach((id) => requestedIconsRef.current.add(id));
    for (let i = 0; i < missingWpns.length; i += 12) {
      const chunk = missingWpns.slice(i, i + 12);
      const url = buildIconSheetSwfUrl(serverUrl, 'items', chunk.join(','));
      iconBridgeRef.current?.captureSkillIcons(url, chunk);
    }
  }, [bridgeReady, serverUrl, pagedEntries, iconUris]);

  const handleBridgeEvent = (ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') setBridgeReady(true);
    else if (ev.type === 'SKILL_ICONS' && ev.icons) {
      setIconUris((prev) => ({ ...prev, ...ev.icons }));
    }
  };

  return (
    <NinjaScrollWindow
      title="Blacksmith"
      bgSource={BUILDING_BGS.blacksmith}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <View style={styles.headerRightRow}>
          <View style={styles.magRow}>
            {MAGATAMA_IDS.map((mId) => (
              <View key={mId} style={styles.magChip}>
                <View style={styles.magIconBox}>
                  {iconUris[mId] ? (
                    <Image source={{ uri: iconUris[mId] }} style={styles.iconImg} resizeMode="cover" />
                  ) : (
                    <Text style={styles.magFallback}>🔮</Text>
                  )}
                </View>
                <Text style={styles.magQty}>x{ownedMats[mId] ?? 0}</Text>
              </View>
            ))}
          </View>
          <View style={styles.currencyPill}>
            <Text style={styles.currencyTxt}>
              🪙 {(profile?.gold ?? 0).toLocaleString()} • 💎 {(profile?.tokens ?? 0).toLocaleString()}
            </Text>
          </View>
        </View>
      }
    >
      {/* Hidden 1x1 SWF Icon Capture Bridge */}
      <View style={styles.hiddenBridge} pointerEvents="none">
        <RuffleStageView ref={iconBridgeRef} baseUrl={serverUrl} onEvent={handleBridgeEvent} />
      </View>

      <NinjaToast message={message} />

      <View style={styles.container}>

        {/* Encyclopedia-Style Split View */}
        <View style={styles.splitBody}>
          {/* Left: Uniform Recipe List */}
          <View style={styles.leftCol}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
              </View>
            ) : (
              <>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listWrap}>
                  {pagedEntries.length === 0 ? (
                    <Text style={styles.emptyTxt}>No matching recipes found.</Text>
                  ) : (
                    pagedEntries.map(([outId, rec]) => {
                      const meta = itemsById[outId];
                      const active = selectedEntry?.[0] === outId;
                      const owned = ownedWeapons.has(outId);
                      const hasReq = !rec.req_weapon || ownedWeapons.has(rec.req_weapon);
                      const hasMats = Object.entries(rec.mats ?? {}).every(
                        ([mId, qty]) => (ownedMats[mId] ?? 0) >= qty
                      );
                      const ready = hasReq && hasMats;
                      return (
                        <Pressable
                          key={outId}
                          style={[styles.tile, active && styles.tileActive]}
                          onPress={() => {
                            playClickSfx(serverUrl);
                            setSelectedId(outId);
                          }}
                        >
                          <View style={styles.tileIconBox}>
                            {iconUris[outId] ? (
                              <Image
                                source={{ uri: iconUris[outId] }}
                                style={styles.tileIconImg}
                                resizeMode="contain"
                              />
                            ) : (
                              <Text style={styles.fallbackIcon}>⚒️</Text>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.tileName} numberOfLines={1}>
                              {meta?.name ?? outId}
                            </Text>
                            <Text style={styles.tileSub} numberOfLines={1}>
                              Lv.{meta?.level ?? 1}
                              {meta?.damage ? ` • DMG ${meta.damage}` : ''}
                              {owned ? ' • OWNED ✓' : ready ? ' • READY TO FORGE' : ''}
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

          {/* Right: Clean Encyclopedia Detail & Forge Card */}
          <View style={styles.rightCol}>
            {selectedEntry ? (() => {
              const [outId, rec] = selectedEntry;
              const meta = itemsById[outId];
              const reqWpn = rec.req_weapon;
              const hasReqWpn = !reqWpn || ownedWeapons.has(reqWpn);
              const matEntries = Object.entries(rec.mats ?? {});
              const owned = ownedWeapons.has(outId);

              return (
                <View style={styles.detailCard}>
                  <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
                    <View style={styles.detailHeader}>
                      <View style={styles.detailIconBig}>
                        {iconUris[outId] ? (
                          <Image
                            source={{ uri: iconUris[outId] }}
                            style={styles.detailIconImg}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={{ fontSize: 24 }}>⚒️</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailTitle}>{meta?.name ?? outId}</Text>
                        <View style={styles.badgeRow}>
                          <View style={styles.typeBadge}>
                            <Text style={styles.typeBadgeTxt}>
                              Weapon • Lv.{meta?.level ?? 1}
                            </Text>
                          </View>
                          {owned ? (
                            <View style={[styles.typeBadge, { backgroundColor: '#15803D' }]}>
                              <Text style={styles.typeBadgeTxt}>✓ OWNED</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </View>

                    <View style={styles.statChips}>
                      {meta?.damage ? <Text style={styles.statChip}>⚔️ DMG: {meta.damage}</Text> : null}
                      {rec.gold > 0 ? (
                        <Text style={styles.statChip}>🪙 {rec.gold.toLocaleString()} Gold</Text>
                      ) : null}
                      {rec.tokens > 0 ? (
                        <Text style={styles.statChip}>💎 {rec.tokens.toLocaleString()} Tokens</Text>
                      ) : null}
                    </View>

                    <View style={styles.descBox}>
                      <Text style={styles.descHeading}>Description</Text>
                      <Text style={styles.descBody}>
                        {meta?.description || 'Forged shinobi weapon with enhanced battle stats.'}
                      </Text>
                    </View>

                    <View style={styles.reqBox}>
                      <Text style={styles.reqHeading}>Required Materials</Text>
                      {reqWpn ? (
                        <Text style={[styles.reqBaseTxt, hasReqWpn ? styles.okTxt : styles.missTxt]}>
                          Base Weapon: {itemsById[reqWpn]?.name ?? reqWpn} ({hasReqWpn ? 'Owned ✓' : 'Missing ✗'})
                        </Text>
                      ) : null}
                      {matEntries.length > 0 ? (
                        <View style={styles.reqMatsRow}>
                          {matEntries.map(([mId, qty]) => {
                            const have = ownedMats[mId] ?? 0;
                            const enough = have >= qty;
                            return (
                              <View
                                key={mId}
                                style={[styles.reqMatChip, enough && styles.reqMatChipOk]}
                              >
                                <View style={styles.reqMatIconBox}>
                                  {iconUris[mId] ? (
                                    <Image
                                      source={{ uri: iconUris[mId] }}
                                      style={styles.iconImg}
                                      resizeMode="cover"
                                    />
                                  ) : (
                                    <Text style={styles.magFallback}>🔮</Text>
                                  )}
                                </View>
                                <Text style={[styles.reqMatQty, enough ? styles.okTxt : styles.missTxt]}>
                                  {have}/{qty}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  </ScrollView>

                  <View style={styles.forgeActionRow}>
                    {rec.gold > 0 ? (
                      <Pressable
                        style={[styles.forgeBtn, styles.btnOrange, busyId !== null && styles.btnDisabled]}
                        disabled={busyId !== null}
                        onPress={() => handleForge(outId, 'gold')}
                      >
                        <Text style={styles.forgeBtnTxt}>
                          {busyId === `${outId}-gold`
                            ? 'Forging...'
                            : `⚒️ Forge (${rec.gold.toLocaleString()} Gold)`}
                        </Text>
                      </Pressable>
                    ) : null}
                    {rec.tokens > 0 ? (
                      <Pressable
                        style={[styles.forgeBtn, styles.btnBlue, busyId !== null && styles.btnDisabled]}
                        disabled={busyId !== null}
                        onPress={() => handleForge(outId, 'tokens')}
                      >
                        <Text style={styles.forgeBtnTxt}>
                          {busyId === `${outId}-tokens`
                            ? 'Forging...'
                            : `⚒️ Forge (${rec.tokens} Tokens)`}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })() : (
              <View style={styles.center}>
                <Text style={styles.emptyTxt}>Select a weapon recipe to view details.</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  hiddenBridge: { position: 'absolute', width: 1, height: 1, opacity: 0.01, left: -10, top: -10 },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  magRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  magChip: { alignItems: 'center', gap: 1 },
  magIconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#231309',
    borderWidth: 1,
    borderColor: '#D9A438',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  magFallback: { fontSize: 12 },
  magQty: { color: '#FFE082', fontSize: 8.5, fontWeight: '900' },
  iconImg: { width: '100%', height: '100%' },
  currencyPill: {
    backgroundColor: '#3E2008',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  currencyTxt: { color: '#FFE082', fontWeight: '800', fontSize: 11 },
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
  topBarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titlePill: {
    backgroundColor: NS_THEME.tabActive,
    borderWidth: 1.5,
    borderColor: '#FFE082',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  titlePillTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
  searchInput: {
    flex: 1,
    maxWidth: 260,
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
  badgeRow: { flexDirection: 'row', gap: 5, marginTop: 3 },
  typeBadge: { backgroundColor: '#B45309', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  typeBadgeTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 10 },
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
  reqBox: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    padding: 9,
    gap: 6,
  },
  reqHeading: { color: NS_THEME.inkMid, fontWeight: '900', fontSize: 10.5 },
  reqBaseTxt: { fontSize: 11.5, fontWeight: '800' },
  okTxt: { color: '#15803D' },
  missTxt: { color: '#B91C1C' },
  reqMatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reqMatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FDE8E8',
    borderWidth: 1.25,
    borderColor: '#DC2626',
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  reqMatChipOk: { backgroundColor: '#DCFCE7', borderColor: '#16A34A' },
  reqMatIconBox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#231309',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  reqMatQty: { fontSize: 11, fontWeight: '900' },
  forgeActionRow: { flexDirection: 'row', gap: 8 },
  forgeBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#3E2008',
    alignItems: 'center',
  },
  forgeBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
  btnOrange: { backgroundColor: NS_THEME.btnOrange },
  btnBlue: { backgroundColor: NS_THEME.btnBlue },
  btnDisabled: { opacity: 0.45 },
});
