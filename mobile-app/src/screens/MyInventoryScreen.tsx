import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { buildPlayerSwfUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

type BagCategory = 'wpn' | 'set' | 'back' | 'accessory' | 'hair' | 'material';

const BAG_TABS: Array<{ key: BagCategory; icon: string; label: string }> = [
  { key: 'wpn', icon: '⚔️', label: 'Weapons' },
  { key: 'set', icon: '👘', label: 'Outfits' },
  { key: 'back', icon: '🎒', label: 'Back' },
  { key: 'accessory', icon: '💍', label: 'Accessory' },
  { key: 'hair', icon: '💇', label: 'Hair' },
  { key: 'material', icon: '🧱', label: 'Materials' },
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
  const [selectedId, setSelectedId] = useState<string>('');
  const [previewAnim, setPreviewAnim] = useState<'standby' | 'attack_01'>('standby');
  const [bridgeReady, setBridgeReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadLibraryData(serverUrl)
      .then((lib) => setItemsById(lib.itemsById ?? {}))
      .catch((err) => setNotice(String(err)))
      .finally(() => setLoading(false));
  }, [serverUrl]);

  const ownedEntries = useMemo<Array<{ id: string; qty?: number }>>(() => {
    if (!profile) return [];
    if (cat === 'wpn') return profile.ownedWeapons.map((id) => ({ id }));
    if (cat === 'set') return profile.ownedClothing.map((id) => ({ id }));
    if (cat === 'back') return profile.ownedBackItems.map((id) => ({ id }));
    if (cat === 'accessory') return profile.ownedAccessories.map((id) => ({ id }));
    if (cat === 'hair') return profile.ownedHairs.map((id) => ({ id }));
    return Object.entries(profile.ownedMaterials).map(([id, qty]) => ({ id, qty }));
  }, [profile, cat]);

  const activeEquippedId = useMemo(() => {
    if (!profile) return '';
    if (cat === 'wpn') return profile.weapon;
    if (cat === 'set') return profile.clothing;
    if (cat === 'back') return profile.back;
    if (cat === 'accessory') return profile.accessory;
    if (cat === 'hair') return profile.hairStyle;
    return '';
  }, [profile, cat]);

  useEffect(() => {
    if (ownedEntries.length > 0) {
      const exists = ownedEntries.some((e) => e.id === selectedId);
      if (!exists) {
        setSelectedId(
          activeEquippedId && ownedEntries.some((e) => e.id === activeEquippedId)
            ? activeEquippedId
            : ownedEntries[0].id
        );
      }
    } else {
      setSelectedId('');
    }
  }, [ownedEntries, activeEquippedId, selectedId]);

  // Live 36 FPS character preview with try-on override for the selected owned item
  useEffect(() => {
    if (!profile || !bridgeReady) return;
    const overrides: { weapon?: string; clothing?: string; back?: string; hair?: string } = {};
    if (selectedId) {
      if (cat === 'wpn') overrides.weapon = selectedId;
      else if (cat === 'set') overrides.clothing = selectedId;
      else if (cat === 'back') overrides.back = selectedId;
      else if (cat === 'hair') overrides.hair = selectedId;
    }
    const tag = `${profile.hairStyle}_${profile.hairColor}_${profile.clothing}_${profile.weapon}_${profile.back}_${selectedId}_${previewAnim}`;
    const url = buildPlayerSwfUrl(serverUrl, profile.charId, previewAnim, tag, overrides);
    stageRef.current?.loadSwf(url);
  }, [serverUrl, profile, bridgeReady, cat, selectedId, previewAnim]);

  const handleStageEvent = (ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') setBridgeReady(true);
  };

  if (!profile) return null;

  const selectedMeta = selectedId ? itemsById[selectedId] : undefined;
  const isSelectedEquipped = Boolean(selectedId && selectedId === activeEquippedId);

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
          profile.hairColor,
          profile.skinColor,
        ],
        { sessionKey, charId: profile.charId }
      );
      if ((res.data?.status as number) === 1) {
        const raw = await api.getCharacter(profile.charId, sessionKey);
        setProfileFromRaw(profile.charId, raw);
        setNotice(`Berhasil memasang ${itemsById[itemId]?.name ?? itemId}!`);
      } else {
        setNotice(String(res.data?.error ?? 'Gagal memasang gear.'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <NinjaScrollWindow
      title="Inventory"
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
      {notice && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{notice}</Text>
        </View>
      )}

      {/* Category Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsRow}
      >
        {BAG_TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tabChip, cat === t.key && styles.tabChipActive]}
            onPress={() => {
              playClickSfx(serverUrl);
              setCat(t.key);
            }}
          >
            <Text style={[styles.tabTxt, cat === t.key && styles.tabTxtActive]}>
              {t.icon} {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.body}>
        {/* Left: Live 36 FPS Character Fitting Room */}
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

          <View style={styles.detailBox}>
            <Text style={styles.detailName} numberOfLines={1}>
              {selectedMeta?.name ?? (selectedId || 'Pilih Item')}
            </Text>
            {selectedMeta ? (
              <>
                <Text style={styles.detailStats}>
                  Lv.{selectedMeta.level || 1}
                  {selectedMeta.damage ? ` • DMG ${selectedMeta.damage}` : ''}
                </Text>
                <Text style={styles.detailDesc} numberOfLines={2}>
                  {selectedMeta.description || 'Perlengkapan shinobi milikmu.'}
                </Text>
              </>
            ) : null}

            {cat !== 'material' && selectedId ? (
              <Pressable
                style={[
                  styles.equipBtn,
                  isSelectedEquipped && styles.equippedBtn,
                ]}
                disabled={isSelectedEquipped || busyId !== null}
                onPress={() => handleEquip(selectedId)}
              >
                <Text style={styles.equipBtnTxt}>
                  {busyId === selectedId
                    ? 'Memasang...'
                    : isSelectedEquipped
                      ? '★ Sedang Dipakai'
                      : '✓ Pasang (Equip)'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Right: Owned Items Grid */}
        <View style={styles.gridPane}>
          <Text style={styles.sectionTitle}>
            Item Dimiliki ({ownedEntries.length}) — Ketuk untuk Preview & Pasang
          </Text>
          {loading ? (
            <ActivityIndicator color={NS_THEME.btnOrange} style={{ marginTop: 20 }} />
          ) : ownedEntries.length === 0 ? (
            <Text style={styles.emptyTxt}>
              Belum ada item di kategori ini. Kunjungi Ninja Shop atau Hunting House!
            </Text>
          ) : (
            <ScrollView contentContainerStyle={styles.grid}>
              {ownedEntries.map(({ id, qty }) => {
                const meta = itemsById[id];
                const isEq = id === activeEquippedId;
                const isSel = id === selectedId;
                return (
                  <Pressable
                    key={id}
                    style={[
                      styles.itemCard,
                      isEq && styles.itemCardEq,
                      isSel && styles.itemCardSel,
                    ]}
                    onPress={() => {
                      playClickSfx(serverUrl);
                      setSelectedId(id);
                    }}
                  >
                    <View style={styles.cardTop}>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {meta?.name ?? id}
                      </Text>
                      {isEq ? <Text style={styles.eqStar}>★</Text> : null}
                    </View>
                    <Text style={styles.itemMeta}>
                      {cat === 'material'
                        ? `Jumlah: x${qty ?? 1}`
                        : `Lv.${meta?.level ?? 1}${meta?.damage ? ` • DMG ${meta.damage}` : ''}`}
                    </Text>
                    <Text style={[styles.itemTag, isEq && { color: '#15803D' }]}>
                      {isEq ? 'EQUIPPED' : cat === 'material' ? 'MATERIAL' : 'OWNED'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
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
    width: '36%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
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
  detailBox: { gap: 3 },
  detailName: { color: NS_THEME.inkDark, fontSize: 12, fontWeight: '900' },
  detailStats: { color: '#9A3412', fontSize: 10, fontWeight: '900' },
  detailDesc: { color: NS_THEME.inkMid, fontSize: 9.5, fontWeight: '600', lineHeight: 13 },
  equipBtn: {
    marginTop: 4,
    backgroundColor: NS_THEME.btnGreen,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    borderRadius: 7,
    paddingVertical: 7,
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
  emptyTxt: { color: NS_THEME.inkMid, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 14 },
  itemCard: {
    width: '31.8%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 6,
    gap: 2,
  },
  itemCardEq: { borderColor: NS_THEME.btnGreen, backgroundColor: '#E7F6E5' },
  itemCardSel: { borderColor: NS_THEME.btnOrange, borderWidth: 2, backgroundColor: NS_THEME.parchmentSelected },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    backgroundColor: NS_THEME.stageDark,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconImg: { width: '100%', height: '100%' },
  iconFallback: { fontSize: 14 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 2 },
  itemName: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900', flex: 1 },
  eqStar: { color: '#D97706', fontSize: 11, fontWeight: '900' },
  itemMeta: { color: NS_THEME.inkSoft, fontSize: 8.5, fontWeight: '700' },
  itemTag: { color: '#B45309', fontSize: 8.5, fontWeight: '900', marginTop: 1 },
});
