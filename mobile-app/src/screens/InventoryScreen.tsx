import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileApiClient } from '../api/client';
import {
  loadGameData,
  loadLibraryData,
  type LibraryItemDef,
  type SkillDef,
} from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { buildPlayerSwfUrl, buildSwfAssetUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle } from '../stage/RuffleStageView';
import { useAuthStore, type CharacterPoints } from '../store/useAuthStore';

type MainTab = 'gear' | 'jutsu' | 'stats';
type GearCategory = 'wpn' | 'set' | 'back' | 'accessory' | 'hair' | 'item';
type CurrencyFilter = 'all' | 'gold' | 'token';
type CatalogView = 'shop' | 'owned';

const GEAR_CATEGORIES: Array<{ key: GearCategory; label: string; icon: string }> = [
  { key: 'wpn', label: 'Weapons', icon: '⚔️' },
  { key: 'set', label: 'Clothing', icon: '👘' },
  { key: 'back', label: 'Back', icon: '🎒' },
  { key: 'accessory', label: 'Accessory', icon: '💍' },
  { key: 'hair', label: 'Hair', icon: '💇' },
  { key: 'item', label: 'Items', icon: '🧪' },
];

const STAT_META: Array<{
  key: keyof Omit<CharacterPoints, 'free'>;
  label: string;
  color: string;
  bonus: string;
}> = [
  { key: 'wind', label: 'Wind', color: '#22C55E', bonus: '+0.4% Dodge & +1 Agility / pt' },
  { key: 'fire', label: 'Fire', color: '#EF4444', bonus: '+0.4% All DMG & Combustion / pt' },
  { key: 'lightning', label: 'Lightning', color: '#FACC15', bonus: '+0.4% Crit & +0.8% Crit DMG / pt' },
  { key: 'water', label: 'Water', color: '#38BDF8', bonus: '+30 Max CP & Purify / pt' },
  { key: 'earth', label: 'Earth', color: '#D97706', bonus: '+30 Max HP & Reactive / pt' },
];

export function InventoryScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const [tab, setTab] = useState<MainTab>('gear');
  const [gearCat, setGearCat] = useState<GearCategory>('wpn');
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilter>('all');
  const [catalogView, setCatalogView] = useState<CatalogView>('shop');
  const [previewAnim, setPreviewAnim] = useState<'standby' | 'attack_01'>('standby');
  const [selectedItemId, setSelectedItemId] = useState<string>('');

  const [skillsById, setSkillsById] = useState<Record<string, SkillDef>>({});
  const [libraryItems, setLibraryItems] = useState<LibraryItemDef[]>([]);
  const [itemsById, setItemsById] = useState<Record<string, LibraryItemDef>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  useEffect(() => {
    if (profile?.points) {
      setDraftPoints(profile.points);
    }
  }, [profile?.points]);

  useEffect(() => {
    Promise.all([loadGameData(serverUrl), loadLibraryData(serverUrl)])
      .then(([gameBundle, libBundle]) => {
        setSkillsById(gameBundle.skillsById);
        setItemsById(libBundle.itemsById);
        setLibraryItems(libBundle.items);
      })
      .catch((err) => setNotice(String(err)))
      .finally(() => setLoading(false));
  }, [serverUrl]);

  const refreshProfile = async () => {
    if (!profile || !sessionKey) return;
    const refreshed = await api.getCharacter(profile.charId, sessionKey);
    setProfileFromRaw(profile.charId, refreshed);
  };

  const ownedForCategory = useMemo(() => {
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
      case 'item': {
        const inv = (profile.raw?.character_inventory ?? {}) as Record<string, unknown>;
        const rawItems = String(inv.char_items ?? '');
        return rawItems
          .split(',')
          .map((e) => e.split(':')[0].trim())
          .filter(Boolean);
      }
    }
  }, [profile, gearCat]);

  const equippedForCategory = useMemo(() => {
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
      default:
        return '';
    }
  }, [profile, gearCat]);

  // ALL authentic buyable Ninja Saga Shop items for the selected category!
  const shopItemsForCategory = useMemo(() => {
    if (!profile) return [];
    const gSuffix = profile.gender === 0 ? '_0' : '_1';
    return libraryItems
      .filter((it) => {
        if (it.type !== gearCat) return false;
        if (!it.buyable) return false;
        if ((gearCat === 'set' || gearCat === 'hair') && !it.id.endsWith(gSuffix)) {
          return false;
        }
        if (currencyFilter === 'gold' && it.price_gold <= 0) return false;
        if (currencyFilter === 'token' && it.price_tokens <= 0) return false;
        return true;
      })
      .sort((a, b) => a.level - b.level || a.price_gold - b.price_gold || a.price_tokens - b.price_tokens);
  }, [libraryItems, gearCat, currencyFilter, profile]);

  const displayedList: LibraryItemDef[] = useMemo(() => {
    if (catalogView === 'shop') return shopItemsForCategory;
    return ownedForCategory
      .map((id) => itemsById[id])
      .filter((it): it is LibraryItemDef => Boolean(it));
  }, [catalogView, shopItemsForCategory, ownedForCategory, itemsById]);

  // Sync selectedItemId when category or view changes
  useEffect(() => {
    if (tab !== 'gear' || displayedList.length === 0) return;
    if (!displayedList.some((it) => it.id === selectedItemId)) {
      setSelectedItemId(displayedList[0].id);
    }
  }, [tab, displayedList, selectedItemId]);

  const selectedItem = itemsById[selectedItemId] ?? displayedList[0] ?? null;

  // Live 36 FPS Ruffle Fitting Room / SWF Asset Preview!
  useEffect(() => {
    if (tab !== 'gear' || !profile || !selectedItem) return;
    const timer = setTimeout(() => {
      if (gearCat === 'item') {
        const url = buildSwfAssetUrl(serverUrl, 'consumables', `${selectedItem.id}.swf`);
        stageRef.current?.loadSwf(url);
      } else if (gearCat === 'accessory') {
        const url = buildSwfAssetUrl(serverUrl, 'items', `${selectedItem.id}.swf`);
        stageRef.current?.loadSwf(url);
      } else {
        // Live Try-On on your actual Ninja character!
        const overrides = {
          weapon: gearCat === 'wpn' ? selectedItem.id : profile.weapon,
          clothing: gearCat === 'set' ? selectedItem.id : profile.clothing,
          back: gearCat === 'back' ? selectedItem.id : profile.back,
          hair: gearCat === 'hair' ? selectedItem.id : profile.hairStyle,
        };
        const tag = `${overrides.hair}_${overrides.clothing}_${overrides.weapon}_${overrides.back}`;
        const url = buildPlayerSwfUrl(serverUrl, profile.charId, previewAnim, tag, overrides);
        stageRef.current?.loadSwf(url);
      }
    }, 240);
    return () => clearTimeout(timer);
  }, [tab, serverUrl, profile, selectedItem, gearCat, previewAnim]);

  const handleToggleEquipSkill = async (skillId: string) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    const isEquipped = profile.equippedSkills.includes(skillId);
    let nextSkills: string[];
    if (isEquipped) {
      if (profile.equippedSkills.length <= 1) {
        setNotice('Minimal 1 Jutsu harus tetap terpasang.');
        return;
      }
      nextSkills = profile.equippedSkills.filter((id) => id !== skillId);
    } else {
      if (profile.equippedSkills.length >= 6) {
        setNotice('Maksimal 6 Jutsu yang bisa dipasang di Battle Bar.');
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
      await refreshProfile();
      setNotice(`Loadout diperbarui (${nextSkills.length}/6 Jutsu terpasang).`);
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
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
      const payload = res.data;
      if ((payload?.status as number) === 1) {
        setNotice(`Berhasil membeli ${item.name}!`);
        await refreshProfile();
      } else {
        setNotice(String(payload?.result ?? payload?.error ?? 'Pembelian gagal.'));
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
        await refreshProfile();
        const label = itemsById[itemId]?.name ?? itemId;
        setNotice(`Berhasil memasang ${label}!`);
      } else {
        setNotice(String(res.data?.error ?? 'Gagal memasang gear.'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const adjustStat = (key: keyof Omit<CharacterPoints, 'free'>, delta: 1 | -1) => {
    if (!profile) return;
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
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId('save_points');
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
        await refreshProfile();
        setNotice('Attribute Points disimpan! Stat battle otomatis meningkat.');
      } else {
        setNotice(String(res.data?.error ?? 'Gagal menyimpan poin.'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  if (!profile) return null;

  const hasUnsavedPoints =
    draftPoints.free !== profile.points.free ||
    draftPoints.wind !== profile.points.wind ||
    draftPoints.fire !== profile.points.fire ||
    draftPoints.lightning !== profile.points.lightning ||
    draftPoints.water !== profile.points.water ||
    draftPoints.earth !== profile.points.earth;

  return (
    <NinjaScrollWindow
      title="Ninja Shop"
      bgSource={BUILDING_BGS.ninjaShop}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <View style={styles.currencyPill}>
          <Text style={styles.goldText}>
            🪙 {profile.gold.toLocaleString()} • 💎 {profile.tokens.toLocaleString()}
          </Text>
        </View>
      }
    >

      {notice && (
        <View style={styles.noticeBox}>
          <Text style={styles.notice}>{notice}</Text>
        </View>
      )}

      {/* TAB 1: AUTHENTIC NINJA SHOP & GEAR WITH LIVE 36 FPS SWF TRY-ON PREVIEW */}
      {tab === 'gear' && (
        <View style={styles.gearWrap}>
          {/* Category Row + Shop/Owned Toggle + Currency Filter */}
          <View style={styles.controlsBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
              {GEAR_CATEGORIES.map((c) => (
                <Pressable
                  key={c.key}
                  style={[styles.catChip, gearCat === c.key && styles.catChipActive]}
                  onPress={() => {
                    playClickSfx(serverUrl);
                    setGearCat(c.key);
                  }}
                >
                  <Text style={styles.catChipText}>
                    {c.icon} {c.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.filterGroup}>
              <Pressable
                style={[styles.miniPill, catalogView === 'shop' && styles.miniPillActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setCatalogView('shop');
                }}
              >
                <Text style={styles.miniPillTxt}>Shop</Text>
              </Pressable>
              <Pressable
                style={[styles.miniPill, catalogView === 'owned' && styles.miniPillActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setCatalogView('owned');
                }}
              >
                <Text style={styles.miniPillTxt}>Owned ({ownedForCategory.length})</Text>
              </Pressable>
              {catalogView === 'shop' && (
                <>
                  {(['all', 'gold', 'token'] as const).map((cf) => (
                    <Pressable
                      key={cf}
                      style={[styles.miniPill, currencyFilter === cf && styles.miniPillGold]}
                      onPress={() => {
                        playClickSfx(serverUrl);
                        setCurrencyFilter(cf);
                      }}
                    >
                      <Text style={styles.miniPillTxt}>{cf.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </>
              )}
            </View>
          </View>

          <View style={styles.body}>
            {/* Left Pane: Live 36 FPS SWF Fitting Room / Asset Preview + Buy/Equip */}
            <View style={styles.previewPane}>
              <View style={styles.previewStageBox}>
                <RuffleStageView ref={stageRef} baseUrl={serverUrl} />
                {gearCat !== 'item' && gearCat !== 'accessory' && (
                  <View style={styles.previewAnimToggle}>
                    <Pressable
                      style={[styles.animChip, previewAnim === 'standby' && styles.animChipOn]}
                      onPress={() => setPreviewAnim('standby')}
                    >
                      <Text style={styles.animChipTxt}>Idle</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.animChip, previewAnim === 'attack_01' && styles.animChipOn]}
                      onPress={() => setPreviewAnim('attack_01')}
                    >
                      <Text style={styles.animChipTxt}>Attack</Text>
                    </Pressable>
                  </View>
                )}
              </View>

              {selectedItem && (
                <View style={styles.detailBox}>
                  <Text style={styles.detailTitle} numberOfLines={1}>
                    {selectedItem.name}
                  </Text>
                  <Text style={styles.detailStats}>
                    Lv.{selectedItem.level}
                    {selectedItem.damage > 0 ? ` • +${selectedItem.damage} DMG` : ''}
                    {selectedItem.premium ? ' • Emblem' : ''}
                  </Text>
                  <Text style={styles.detailDesc} numberOfLines={2}>
                    {selectedItem.description || 'Authentic Ninja Saga equipment.'}
                  </Text>

                  <View style={styles.detailActionRow}>
                    {ownedForCategory.includes(selectedItem.id) && gearCat !== 'item' ? (
                      <Pressable
                        style={[
                          styles.mainActBtn,
                          equippedForCategory === selectedItem.id ? styles.equippedBtn : styles.equipBtn,
                        ]}
                        disabled={equippedForCategory === selectedItem.id || busyId !== null}
                        onPress={() => handleEquipGear(gearCat, selectedItem.id)}
                      >
                        <Text style={styles.mainActText}>
                          {equippedForCategory === selectedItem.id
                            ? '★ Equipped'
                            : busyId === selectedItem.id
                              ? 'Equipping...'
                              : 'Equip Gear'}
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[
                          styles.mainActBtn,
                          styles.buyMainBtn,
                          profile.level < selectedItem.level && styles.lockedBtn,
                        ]}
                        disabled={profile.level < selectedItem.level || busyId !== null}
                        onPress={() => handleBuyGear(selectedItem)}
                      >
                        <Text style={styles.mainActText}>
                          {busyId === selectedItem.id
                            ? 'Buying...'
                            : profile.level < selectedItem.level
                              ? `Req Lv.${selectedItem.level}`
                              : selectedItem.price_tokens > 0
                                ? `Buy (${selectedItem.price_tokens} Tokens)`
                                : `Buy (${selectedItem.price_gold.toLocaleString()} Gold)`}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              )}
            </View>

            {/* Right Pane: Full Shop / Owned Grid */}
            <View style={styles.rightPane}>
              <Text style={styles.sectionTitle}>
                {catalogView === 'shop' ? 'Ninja Shop Catalog' : 'Owned Inventory'} ({displayedList.length}) — Tap to Try On
              </Text>
              {loading ? (
                <ActivityIndicator color="#F59E0B" style={{ marginTop: 20 }} />
              ) : displayedList.length === 0 ? (
                <Text style={styles.emptyText}>Tidak ada item pada kategori ini.</Text>
              ) : (
                <ScrollView contentContainerStyle={styles.shopGrid}>
                  {displayedList.map((it) => {
                    const owned = ownedForCategory.includes(it.id);
                    const equipped = equippedForCategory === it.id;
                    const selected = selectedItem?.id === it.id;
                    const locked = profile.level < it.level;
                    return (
                      <Pressable
                        key={it.id}
                        style={[
                          styles.shopCard,
                          owned && styles.shopCardOwned,
                          selected && styles.shopCardSelected,
                        ]}
                        onPress={() => {
                          playClickSfx(serverUrl);
                          setSelectedItemId(it.id);
                        }}
                      >
                        <View style={styles.cardTopRow}>
                          <Text style={styles.skName} numberOfLines={1}>
                            {it.name}
                          </Text>
                          {equipped ? (
                            <Text style={styles.starIcon}>★</Text>
                          ) : owned ? (
                            <Text style={styles.checkIcon}>✓</Text>
                          ) : null}
                        </View>
                        <Text style={styles.skMeta} numberOfLines={1}>
                          Lv.{it.level}
                          {it.damage > 0 ? ` • +${it.damage} Dmg` : ''}
                        </Text>
                        <Text
                          style={[
                            styles.priceLabel,
                            owned && gearCat !== 'item' && { color: '#4ADE80' },
                            !owned && locked && { color: '#94A3B8' },
                          ]}
                        >
                          {equipped
                            ? 'EQUIPPED'
                            : owned && gearCat !== 'item'
                              ? 'OWNED'
                              : it.price_tokens > 0
                                ? `${it.price_tokens} T`
                                : `${it.price_gold.toLocaleString()} G`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>
        </View>
      )}

      {/* TAB 2: MY JUTSU LOADOUT (Quick shortcut to Academy to learn more!) */}
      {tab === 'jutsu' && (
        <View style={styles.body}>
          <View style={styles.rightPane}>
            <View style={styles.jutsuHeaderRow}>
              <Text style={styles.sectionTitle}>
                Owned Jutsu — Tap to Equip/Unequip ({profile.equippedSkills.length}/6)
              </Text>
              <Pressable
                style={styles.goAcademyBtn}
                onPress={() => {
                  playClickSfx(serverUrl);
                  navigate('academy');
                }}
              >
                <Text style={styles.goAcademyTxt}>📜 Learn More in Academy →</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.shopGrid}>
              {profile.ownedSkills.map((s) => {
                const eq = profile.equippedSkills.includes(s);
                const def = skillsById[s];
                return (
                  <Pressable
                    key={s}
                    style={[styles.shopCard, eq && styles.shopCardSelected]}
                    onPress={() => handleToggleEquipSkill(s)}
                    disabled={busyId === s}
                  >
                    <Text style={styles.skName} numberOfLines={1}>
                      {eq ? '★ ' : '+ '}
                      {def ? def.name : s}
                    </Text>
                    <Text style={styles.skMeta}>
                      {def ? `DMG ${def.damage} • ${def.cp_cost} CP • CD ${def.cooldown}t` : s}
                    </Text>
                    <Text style={[styles.priceLabel, { color: eq ? '#FACC15' : '#38BDF8' }]}>
                      {eq ? 'EQUIPPED' : 'TAP TO EQUIP'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}

      {/* TAB 3: ATTRIBUTE POINTS */}
      {tab === 'stats' && (
        <View style={styles.statsWrap}>
          <View style={styles.statsHeader}>
            <Text style={styles.statsTitle}>
              Free Attribute Points: <Text style={{ color: '#4ADE80' }}>{draftPoints.free}</Text>
            </Text>
            <Pressable
              style={[styles.saveBtn, (!hasUnsavedPoints || busyId === 'save_points') && styles.lockedBtn]}
              disabled={!hasUnsavedPoints || busyId === 'save_points'}
              onPress={handleSavePoints}
            >
              <Text style={styles.saveBtnText}>
                {busyId === 'save_points' ? 'Saving...' : 'Save Points'}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.statsList}>
            {STAT_META.map((st) => {
              const val = draftPoints[st.key];
              const savedVal = profile.points[st.key];
              return (
                <View key={st.key} style={styles.statRow}>
                  <View style={[styles.statDot, { backgroundColor: st.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.statName}>{st.label}</Text>
                    <Text style={styles.statBonus}>{st.bonus}</Text>
                  </View>
                  <View style={styles.statControls}>
                    <Pressable
                      style={[styles.pmBtn, val <= savedVal && styles.lockedBtn]}
                      disabled={val <= savedVal}
                      onPress={() => adjustStat(st.key, -1)}
                    >
                      <Text style={styles.pmText}>-</Text>
                    </Pressable>
                    <Text style={styles.statVal}>{val}</Text>
                    <Pressable
                      style={[styles.pmBtn, draftPoints.free <= 0 && styles.lockedBtn]}
                      disabled={draftPoints.free <= 0}
                      onPress={() => adjustStat(st.key, 1)}
                    >
                      <Text style={styles.pmText}>+</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}
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
  goldText: { color: '#FDE047', fontSize: 10.5, fontWeight: '900' },
  noticeBox: {
    backgroundColor: '#FEF3C7',
    borderColor: '#B45309',
    borderWidth: 1.5,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 5,
  },
  notice: { color: '#78350F', fontSize: 11, fontWeight: '800' },
  gearWrap: { flex: 1 },
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  catRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  catChip: {
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  catChipActive: { backgroundColor: NS_THEME.tabActive, borderColor: NS_THEME.woodBorderDark },
  catChipText: { color: '#FFF', fontSize: 10.5, fontWeight: '900' },
  filterGroup: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  miniPill: {
    backgroundColor: NS_THEME.tabInactive,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
  },
  miniPillActive: { backgroundColor: NS_THEME.btnGreen, borderColor: NS_THEME.woodBorderDark },
  miniPillGold: { backgroundColor: '#B45309', borderColor: NS_THEME.woodBorderDark },
  miniPillTxt: { color: '#FFF', fontSize: 9.5, fontWeight: '900' },
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
  previewStageBox: {
    flex: 1,
    backgroundColor: NS_THEME.stageDark,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    overflow: 'hidden',
    position: 'relative',
  },
  previewAnimToggle: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    gap: 4,
  },
  animChip: {
    backgroundColor: 'rgba(62, 32, 8, 0.88)',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: NS_THEME.goldTrim,
  },
  animChipOn: { backgroundColor: NS_THEME.btnOrange, borderColor: '#FDE047' },
  animChipTxt: { color: '#FFF', fontSize: 9, fontWeight: '900' },
  detailBox: { gap: 2.5 },
  detailTitle: { color: NS_THEME.inkDark, fontSize: 12, fontWeight: '900' },
  detailStats: { color: '#9A3412', fontSize: 10, fontWeight: '900' },
  detailDesc: { color: NS_THEME.inkMid, fontSize: 9.5, fontWeight: '600', lineHeight: 13 },
  detailActionRow: { marginTop: 4 },
  mainActBtn: {
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    paddingVertical: 7,
    alignItems: 'center',
  },
  buyMainBtn: { backgroundColor: NS_THEME.btnOrange },
  equipBtn: { backgroundColor: NS_THEME.btnGreen },
  equippedBtn: { backgroundColor: NS_THEME.btnBlue, opacity: 0.85 },
  lockedBtn: { backgroundColor: NS_THEME.btnDisabled, opacity: 0.65 },
  mainActText: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  rightPane: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
  },
  sectionTitle: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900', marginBottom: 6 },
  emptyText: { color: NS_THEME.inkMid, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 24 },
  shopGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 14 },
  shopCard: {
    width: '31.8%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 6,
    gap: 2,
  },
  shopCardOwned: { borderColor: NS_THEME.btnGreen, backgroundColor: '#E7F6E5' },
  shopCardSelected: { borderColor: NS_THEME.btnOrange, borderWidth: 2, backgroundColor: NS_THEME.parchmentSelected },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 2 },
  skName: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900', flex: 1 },
  starIcon: { color: '#D97706', fontSize: 11, fontWeight: '900' },
  checkIcon: { color: '#15803D', fontSize: 10, fontWeight: '900' },
  skMeta: { color: NS_THEME.inkSoft, fontSize: 8.5, fontWeight: '700' },
  priceLabel: { color: '#B45309', fontSize: 9, fontWeight: '900', marginTop: 1 },
  jutsuHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  goAcademyBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  goAcademyTxt: { color: '#FFF', fontSize: 10, fontWeight: '900' },
  statsWrap: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 10,
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statsTitle: { color: NS_THEME.inkDark, fontSize: 14, fontWeight: '900' },
  saveBtn: { backgroundColor: NS_THEME.btnGreen, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 7 },
  saveBtnText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  statsList: { gap: 8 },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 9,
  },
  statDot: { width: 12, height: 12, borderRadius: 6 },
  statName: { color: NS_THEME.inkDark, fontSize: 13, fontWeight: '900' },
  statBonus: { color: NS_THEME.inkSoft, fontSize: 10, fontWeight: '700' },
  statControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pmBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: NS_THEME.tabInactive,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
  },
  pmText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
  statVal: { color: '#B45309', fontSize: 15, fontWeight: '900', minWidth: 26, textAlign: 'center' },
});
