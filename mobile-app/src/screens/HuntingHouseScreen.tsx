import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { buildIconSheetSwfUrl, buildSwfAssetUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

const ZONE_DROP_COUNTS: Record<
  number,
  { badges: number; xp: number; gold: number; magatama: string; magatamaName: string; weapon: string }
> = {
  0: { badges: 1, xp: 600, gold: 1200, magatama: 'material_01', magatamaName: 'Red Magatama', weapon: 'wpn_82' },
  1: { badges: 2, xp: 1400, gold: 2800, magatama: 'material_02', magatamaName: 'Blue Magatama', weapon: 'wpn_83' },
  2: { badges: 1, xp: 2000, gold: 4000, magatama: 'material_03', magatamaName: 'Green Magatama', weapon: 'wpn_84' },
  3: { badges: 3, xp: 3200, gold: 6500, magatama: 'material_04', magatamaName: 'Purple Magatama', weapon: 'wpn_85' },
  4: { badges: 4, xp: 5000, gold: 10000, magatama: 'material_06', magatamaName: 'Multicolor Magatama', weapon: 'wpn_86' },
};

interface HuntingZone {
  easyBoss: string[] | null;
  hardBoss: string[] | null;
}

interface HuntingBossInfo {
  name: string;
  description: string;
  rewards: string[];
}

interface HuntingForgeItem {
  item: string;
  requirements: {
    materials: string[];
    qty: number[];
  };
}

export function HuntingHouseScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setActiveBattle = useAuthStore((s) => s.setActiveBattle);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [tab, setTab] = useState<'bosses' | 'forge'>('bosses');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2000);
    return () => clearTimeout(t);
  }, [message]);
  const [badges, setBadges] = useState(0);
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [zones, setZones] = useState<HuntingZone[]>([]);
  const [bosses, setBosses] = useState<Record<string, HuntingBossInfo>>({});
  const [forgeItems, setForgeItems] = useState<HuntingForgeItem[]>([]);
  const [itemsById, setItemsById] = useState<Record<string, LibraryItemDef>>({});
  const [previewBoss, setPreviewBoss] = useState<string>('ene_81');
  const [selectedZoneIdx, setSelectedZoneIdx] = useState<number>(0);
  const [inspectedForgeItem, setInspectedForgeItem] = useState<HuntingForgeItem | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [dropIconUris, setDropIconUris] = useState<Record<string, string>>({});
  const requestedIconsRef = useRef<Set<string>>(new Set());

  const loadAll = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const [hhRes, forgeRes, lib] = await Promise.all([
        api.rpc<{
          status: number;
          material?: number;
          daily_claim?: boolean;
          zones?: HuntingZone[];
          bosses?: Record<string, HuntingBossInfo>;
        }>('HuntingHouseService', 'getData', [profile.charId, sessionKey], {
          sessionKey,
          charId: profile.charId,
        }),
        api.rpc<{ status: number; items?: HuntingForgeItem[] }>(
          'HuntingHouseService',
          'getItems',
          [profile.charId, sessionKey],
          { sessionKey, charId: profile.charId }
        ),
        loadLibraryData(serverUrl),
      ]);
      setBadges(hhRes.data?.material ?? 0);
      setDailyClaimed(Boolean(hhRes.data?.daily_claim));
      setZones(hhRes.data?.zones ?? []);
      setBosses(hhRes.data?.bosses ?? {});
      setForgeItems(forgeRes.data?.items ?? []);
      setItemsById(lib.itemsById ?? {});
    } catch (err) {
      setMessage(`Failed to load Hunting House: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey, serverUrl]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!previewBoss || !bridgeReady) return;
    stageRef.current?.loadSwf(buildSwfAssetUrl(serverUrl, 'enemy', previewBoss, 'standby'));
  }, [serverUrl, previewBoss, bridgeReady]);

  useEffect(() => {
    if (!bridgeReady) return;
    const matIds = ['material_509', 'material_01', 'material_02', 'material_03', 'material_04', 'material_06'];
    const missingMats = matIds.filter((id) => !dropIconUris[id] && !requestedIconsRef.current.has(id));
    if (missingMats.length > 0) {
      missingMats.forEach((id) => requestedIconsRef.current.add(id));
      const url = buildIconSheetSwfUrl(serverUrl, 'materials', missingMats.join(','));
      stageRef.current?.captureSkillIcons(url, missingMats);
    }

    const dropWpns = ['wpn_82', 'wpn_83', 'wpn_84', 'wpn_85', 'wpn_86'];
    const missingDropWpns = dropWpns.filter(
      (id) => !dropIconUris[id] && !requestedIconsRef.current.has(id)
    );
    if (missingDropWpns.length > 0) {
      missingDropWpns.forEach((id) => requestedIconsRef.current.add(id));
      const url = buildIconSheetSwfUrl(serverUrl, 'items', missingDropWpns.join(','));
      stageRef.current?.captureSkillIcons(url, missingDropWpns);
    }

    if (tab === 'forge' && forgeItems.length > 0) {
      const missing = forgeItems
        .slice(0, 60)
        .map((fi) => fi.item)
        .filter((id) => !dropIconUris[id] && !requestedIconsRef.current.has(id));
      if (missing.length > 0) {
        missing.forEach((id) => requestedIconsRef.current.add(id));
        for (let i = 0; i < missing.length; i += 12) {
          const chunk = missing.slice(i, i + 12);
          const url = buildIconSheetSwfUrl(serverUrl, 'items', chunk.join(','));
          stageRef.current?.captureSkillIcons(url, chunk);
        }
      }
    }
  }, [bridgeReady, serverUrl, tab, forgeItems]);

  const handleStageEvent = (ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') setBridgeReady(true);
    else if (ev.type === 'SKILL_ICONS' && ev.icons) {
      setDropIconUris((prev) => ({ ...prev, ...ev.icons }));
    }
  };

  const handleDailyClaim = async () => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusy('daily');
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; material?: number }>(
        'HuntingHouseService',
        'dailyClaim',
        [profile.charId, sessionKey],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage('Daily Kari Badge claimed!');
        await loadAll();
      } else {
        setMessage(res.data?.result || 'Already claimed today.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleHunt = async (zoneIndex: number, bossIds: string[]) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusy(`hunt-${zoneIndex}`);
    setMessage(null);
    try {
      const battle = await api.battleStartHunting(profile.charId, sessionKey, zoneIndex + 1, bossIds);
      setActiveBattle(battle);
      navigate('battle');
    } catch (err) {
      setMessage(`Failed to start hunt: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleForge = async (itemId: string) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusy(`forge-${itemId}`);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string }>(
        'HuntingHouseService',
        'forgeItem',
        [profile.charId, sessionKey, itemId],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage(`Forged ${itemsById[itemId]?.name ?? itemId}!`);
        const raw = await api.getCharacter(profile.charId, sessionKey);
        setProfileFromRaw(profile.charId, raw);
        await loadAll();
      } else {
        setMessage(res.data?.result || 'Not enough materials.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <NinjaScrollWindow
      title="Hunting House"
      bgSource={BUILDING_BGS.huntingHouse}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <View style={styles.badgeRow}>
          <View style={styles.badgePill}>
            <Text style={styles.badgeCount}>🏅 Kari Badges: {badges}</Text>
          </View>
          <Pressable
            style={[styles.claimBtn, (dailyClaimed || busy !== null) && styles.disabledBtn]}
            disabled={dailyClaimed || busy !== null}
            onPress={handleDailyClaim}
          >
            <Text style={styles.claimText}>{dailyClaimed ? 'Claimed ✓' : 'Daily Badge'}</Text>
          </Pressable>
        </View>
      }
    >

      <NinjaToast message={message} />

      <View style={styles.body}>
        {/* Left: Live Ruffle Boss SWF Preview + Rewards & Item Drops */}
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle} numberOfLines={1}>
            {bosses[previewBoss]?.name ?? previewBoss}
          </Text>
          <View style={styles.stageBox}>
            <RuffleStageView ref={stageRef} baseUrl={serverUrl} onEvent={handleStageEvent} />
          </View>
          <Text style={styles.previewDesc} numberOfLines={2}>
            {bosses[previewBoss]?.description ?? 'Legendary Hunting House boss.'}
          </Text>
          <View style={styles.dropBox}>
            <Text style={styles.dropHeader}>
              ZONE {selectedZoneIdx + 1} REWARDS & DROPS
            </Text>
            <View style={styles.rewardChipsRow}>
              <Text style={styles.rewardChipTxt}>
                ⭐ +{(ZONE_DROP_COUNTS[selectedZoneIdx]?.xp ?? 1000).toLocaleString()} XP
              </Text>
              <Text style={styles.rewardChipTxt}>
                🪙 +{(ZONE_DROP_COUNTS[selectedZoneIdx]?.gold ?? 2000).toLocaleString()} Gold
              </Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dropItemsRow}
            >
              {(() => {
                const zd = ZONE_DROP_COUNTS[selectedZoneIdx] ?? ZONE_DROP_COUNTS[0];
                const dropList = [
                  {
                    id: 'material_509',
                    label: `Kari Badge x${zd.badges}`,
                    qty: `x${zd.badges}`,
                    fallback: '🏅',
                  },
                  {
                    id: zd.magatama,
                    label: itemsById[zd.magatama]?.name ?? zd.magatamaName,
                    qty: 'x1',
                    fallback: '🔮',
                  },
                  {
                    id: zd.weapon,
                    label: itemsById[zd.weapon]?.name ?? zd.weapon,
                    qty: '',
                    fallback: '⚔️',
                  },
                ];
                return dropList.map((d) => (
                  <Pressable
                    key={d.id}
                    style={styles.dropIconTile}
                    onPress={() => {
                      playClickSfx(serverUrl);
                      setMessage(`Drop: ${d.label}`);
                    }}
                  >
                    {dropIconUris[d.id] ? (
                      <Image source={{ uri: dropIconUris[d.id] }} style={styles.dropIconImg} resizeMode="contain" />
                    ) : (
                      <Text style={{ fontSize: 16 }}>{d.fallback}</Text>
                    )}
                    {d.qty ? (
                      <View style={styles.dropQtyBadge}>
                        <Text style={styles.dropQtyTxt}>{d.qty}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                ));
              })()}
            </ScrollView>
          </View>
        </View>

        {/* Right: Boss Zones or Hunting Forge */}
        <View style={styles.listPane}>
          <View style={styles.tabRow}>
            <Pressable style={[styles.tabBtn, tab === 'bosses' && styles.tabActive]} onPress={() => setTab('bosses')}>
              <Text style={styles.tabText}>Boss Zones ({zones.length})</Text>
            </Pressable>
            <Pressable style={[styles.tabBtn, tab === 'forge' && styles.tabActive]} onPress={() => setTab('forge')}>
              <Text style={styles.tabText}>Hunting Market ({forgeItems.length})</Text>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
          ) : tab === 'bosses' ? (
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollList}>
              {zones.map((z, idx) => {
                const bossIds = z.hardBoss ?? z.easyBoss ?? [];
                const isHard = Boolean(z.hardBoss);
                const names = bossIds.map((id) => bosses[id]?.name ?? id).join(' & ');
                return (
                  <Pressable
                    key={idx}
                    style={[styles.rowCard, bossIds.includes(previewBoss) && styles.rowSelected]}
                    onPress={() => {
                      playClickSfx(serverUrl);
                      setSelectedZoneIdx(idx);
                      if (bossIds[0]) setPreviewBoss(bossIds[0]);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        Zone {idx + 1} ({isHard ? 'HARD • 2 Boss' : 'EASY • 1 Boss'}): {names}
                      </Text>
                      <Text style={styles.rowSub}>
                        Reward: Kari Badge + Magatama + Weapon + XP + Gold
                      </Text>
                    </View>
                    <Pressable
                      style={styles.huntBtn}
                      disabled={busy !== null}
                      onPress={() => handleHunt(idx, bossIds)}
                    >
                      <Text style={styles.huntBtnText}>
                        {busy === `hunt-${idx}` ? '...' : '⚔️ Hunt!'}
                      </Text>
                    </Pressable>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollList}>
              {forgeItems.slice(0, 60).map((fi) => {
                const meta = itemsById[fi.item];
                const reqText = fi.requirements.materials
                  .map((m, i) => `${itemsById[m]?.name ?? m} x${fi.requirements.qty[i] ?? 1}`)
                  .join(', ');
                const iconUri = dropIconUris[fi.item];
                return (
                  <Pressable
                    key={fi.item}
                    delayLongPress={280}
                    style={styles.rowCard}
                    onLongPress={() => {
                      playClickSfx(serverUrl);
                      setInspectedForgeItem(fi);
                    }}
                  >
                    <View style={styles.marketIconBox}>
                      {iconUri ? (
                        <Image source={{ uri: iconUri }} style={styles.dropIconImg} resizeMode="cover" />
                      ) : (
                        <Text style={styles.marketIconFallback}>⚔️</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        {meta?.name ?? fi.item} {meta?.level ? `(Lv.${meta.level})` : ''}
                      </Text>
                      <Text style={styles.rowSub}>Req: {reqText} • Hold for details</Text>
                    </View>
                    <Pressable
                      style={[styles.huntBtn, { backgroundColor: '#16A34A' }]}
                      disabled={busy !== null}
                      onPress={() => handleForge(fi.item)}
                    >
                      <Text style={styles.huntBtnText}>
                        {busy === `forge-${fi.item}` ? '...' : 'Forge'}
                      </Text>
                    </Pressable>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>

      {/* Tap & Hold Hunting Market Item Inspector Modal */}
      <Modal
        visible={inspectedForgeItem !== null}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => setInspectedForgeItem(null)}
      >
        <Pressable
          style={styles.inspectorBackdrop}
          onPress={() => setInspectedForgeItem(null)}
        >
          {inspectedForgeItem ? (
            <Pressable style={styles.inspectorCard} onPress={() => {}}>
              <View style={styles.inspectorHeader}>
                <View style={styles.inspectorIconBox}>
                  {dropIconUris[inspectedForgeItem.item] ? (
                    <Image
                      source={{ uri: dropIconUris[inspectedForgeItem.item] }}
                      style={styles.dropIconImg}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text style={{ fontSize: 24 }}>⚔️</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inspectorTitle} numberOfLines={2}>
                    {itemsById[inspectedForgeItem.item]?.name ?? inspectedForgeItem.item}
                  </Text>
                  <Text style={styles.inspectorSub}>
                    Lv.{itemsById[inspectedForgeItem.item]?.level ?? 1}
                    {(itemsById[inspectedForgeItem.item]?.damage ?? 0) > 0
                      ? ` • +${itemsById[inspectedForgeItem.item]?.damage} DMG`
                      : ''}
                  </Text>
                </View>
                <Pressable
                  style={styles.inspectorCloseBtn}
                  onPress={() => setInspectedForgeItem(null)}
                >
                  <Text style={styles.inspectorCloseTxt}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.inspectorDescBox}>
                <Text style={styles.inspectorDesc}>
                  {itemsById[inspectedForgeItem.item]?.description || 'Authentic Hunting House forge reward.'}
                </Text>
                <Text style={styles.inspectorReq}>
                  Required:{' '}
                  {inspectedForgeItem.requirements.materials
                    .map(
                      (m, i) =>
                        `${itemsById[m]?.name ?? m} x${inspectedForgeItem.requirements.qty[i] ?? 1}`
                    )
                    .join(', ')}
                </Text>
              </View>

              <Pressable
                style={[styles.huntBtn, { backgroundColor: '#16A34A', paddingVertical: 8 }]}
                disabled={busy !== null}
                onPress={() => {
                  const id = inspectedForgeItem.item;
                  setInspectedForgeItem(null);
                  handleForge(id);
                }}
              >
                <Text style={styles.huntBtnText}>⚒️ Forge Item</Text>
              </Pressable>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgePill: {
    backgroundColor: '#3E2008', borderRadius: 8, borderWidth: 1.5, borderColor: NS_THEME.goldTrim,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  badgeCount: { color: '#FDE047', fontSize: 10.5, fontWeight: '900' },
  claimBtn: {
    backgroundColor: NS_THEME.btnGreen, borderWidth: 1.5, borderColor: NS_THEME.woodBorderDark,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6,
  },
  disabledBtn: { opacity: 0.45 },
  claimText: { color: '#FFF', fontSize: 10, fontWeight: '900' },
  banner: {
    backgroundColor: '#FEF3C7', borderColor: '#B45309', borderWidth: 1.5,
    borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6,
  },
  bannerText: { color: '#78350F', fontSize: 11, fontWeight: '800' },
  body: { flex: 1, flexDirection: 'row', gap: 10 },
  previewCard: {
    width: 245, backgroundColor: NS_THEME.parchmentCard, borderRadius: 10,
    borderWidth: 1.5, borderColor: NS_THEME.woodBorder, padding: 8, gap: 5,
  },
  previewTitle: { color: NS_THEME.inkDark, fontSize: 13, fontWeight: '900' },
  stageBox: {
    flex: 1, minHeight: 135, backgroundColor: NS_THEME.stageDark, borderRadius: 8,
    borderWidth: 1.5, borderColor: NS_THEME.woodBorder, overflow: 'hidden',
  },
  previewDesc: { color: NS_THEME.inkMid, fontSize: 9.5, fontWeight: '600' },
  dropBox: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 7,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    padding: 6,
    gap: 4,
  },
  dropHeader: { color: NS_THEME.inkDark, fontSize: 8.5, fontWeight: '900', letterSpacing: 0.4 },
  rewardChipsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rewardChipTxt: { color: '#9A3412', fontSize: 9.5, fontWeight: '900' },
  dropItemsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  dropIconTile: {
    width: 38,
    height: 38,
    borderRadius: 7,
    backgroundColor: NS_THEME.stageDark,
    borderWidth: 1.5,
    borderColor: '#D9A438',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dropIconImg: { width: '92%', height: '92%' },
  dropQtyBadge: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    backgroundColor: 'rgba(20, 12, 6, 0.88)',
    borderRadius: 3,
    paddingHorizontal: 3,
  },
  dropQtyTxt: { color: '#FDE047', fontSize: 8, fontWeight: '900' },
  marketIconBox: {
    width: 42,
    height: 42,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    backgroundColor: NS_THEME.stageDark,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  marketIconFallback: { fontSize: 18 },
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
  inspectorHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  inspectorTitle: { color: NS_THEME.inkDark, fontSize: 13.5, fontWeight: '900' },
  inspectorSub: { color: '#9A3412', fontSize: 10, fontWeight: '800', marginTop: 2 },
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
    gap: 6,
  },
  inspectorDesc: { color: NS_THEME.inkDark, fontSize: 11, fontWeight: '600', lineHeight: 16 },
  inspectorReq: { color: '#9A3412', fontSize: 10, fontWeight: '800' },
  listPane: {
    flex: 1, backgroundColor: NS_THEME.parchmentCardAlt, borderRadius: 10,
    borderWidth: 1.5, borderColor: NS_THEME.woodBorder, padding: 8,
  },
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  tabBtn: {
    backgroundColor: NS_THEME.tabInactive, borderWidth: 1.5, borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6,
  },
  tabActive: { backgroundColor: NS_THEME.btnRed, borderColor: NS_THEME.woodBorderDark },
  tabText: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  scrollList: { gap: 6, paddingBottom: 14 },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8, borderWidth: 1.5, borderColor: NS_THEME.woodBorder, padding: 8, gap: 8,
  },
  rowSelected: { borderColor: NS_THEME.btnOrange, backgroundColor: NS_THEME.parchmentSelected, borderWidth: 2 },
  rowTitle: { color: NS_THEME.inkDark, fontSize: 11.5, fontWeight: '900' },
  rowSub: { color: NS_THEME.inkSoft, fontSize: 9.5, fontWeight: '700', marginTop: 2 },
  huntBtn: {
    backgroundColor: NS_THEME.btnRed, borderWidth: 1.5, borderColor: NS_THEME.woodBorderDark,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 6,
  },
  huntBtnText: { color: '#FFF', fontSize: 10.5, fontWeight: '900' },
});
