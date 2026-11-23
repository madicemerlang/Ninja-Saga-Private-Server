import React, { useEffect, useMemo, useState } from 'react';
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
import { useAuthStore, type CharacterPoints } from '../store/useAuthStore';

type MainTab = 'jutsu' | 'gear' | 'stats';
type GearCategory = 'wpn' | 'set' | 'back' | 'accessory' | 'hair';

const GEAR_CATEGORIES: Array<{ key: GearCategory; label: string }> = [
  { key: 'wpn', label: 'Weapons' },
  { key: 'set', label: 'Clothing' },
  { key: 'back', label: 'Back' },
  { key: 'accessory', label: 'Accessory' },
  { key: 'hair', label: 'Hair' },
];

const STAT_META: Array<{
  key: keyof Omit<CharacterPoints, 'free'>;
  label: string;
  color: string;
  bonus: string;
}> = [
  { key: 'wind', label: 'Wind', color: '#22C55E', bonus: '+1.2% Dodge & +1 Agility / pt' },
  { key: 'fire', label: 'Fire', color: '#EF4444', bonus: '+2.5% Attack Damage / pt' },
  { key: 'lightning', label: 'Lightning', color: '#FACC15', bonus: '+1.5% Crit Chance / pt' },
  { key: 'water', label: 'Water', color: '#38BDF8', bonus: '+30 Max CP / pt' },
  { key: 'earth', label: 'Earth', color: '#D97706', bonus: '+30 Max HP / pt' },
];

export function InventoryScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const [tab, setTab] = useState<MainTab>('jutsu');
  const [gearCat, setGearCat] = useState<GearCategory>('wpn');

  const [buyableSkills, setBuyableSkills] = useState<SkillDef[]>([]);
  const [skillsById, setSkillsById] = useState<Record<string, SkillDef>>({});
  const [libraryItems, setLibraryItems] = useState<LibraryItemDef[]>([]);
  const [itemsById, setItemsById] = useState<Record<string, LibraryItemDef>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Draft points for Stats tab
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
        const skillList = gameBundle.skills
          .filter((s) => s.buyable && s.price_gold > 0 && s.price_tokens === 0)
          .sort((a, b) => a.level - b.level)
          .slice(0, 40);
        setBuyableSkills(skillList);

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

  const handleToggleEquipSkill = async (skillId: string) => {
    if (!profile || !sessionKey) return;
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
      setNotice(`Loadout updated (${nextSkills.length} Jutsu equipped)`);
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const handleBuySkill = async (skill: SkillDef) => {
    if (!profile || !sessionKey) return;
    setBusyId(skill.id);
    setNotice(null);
    try {
      const res = await api.rpc<Record<string, unknown>>(
        'CharacterService',
        'buySkill',
        [sessionKey, profile.charId, skill.id],
        { sessionKey, charId: profile.charId }
      );
      const payload = res.data;
      if ((payload?.status as number) === 1) {
        setNotice(`Learned ${skill.name}!`);
        await refreshProfile();
      } else {
        setNotice(String(payload?.result ?? payload?.error ?? 'Cannot learn skill'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const handleBuyGear = async (item: LibraryItemDef) => {
    if (!profile || !sessionKey) return;
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
        setNotice(`Purchased ${item.name}! Tap di sebelah kiri untuk Equip.`);
        await refreshProfile();
      } else {
        setNotice(String(payload?.result ?? payload?.error ?? 'Cannot buy item'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const handleEquipGear = async (cat: GearCategory, itemId: string) => {
    if (!profile || !sessionKey) return;
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
        setNotice(`Equipped ${label}! Tampilan karakter otomatis diperbarui.`);
      } else {
        setNotice(String(res.data?.error ?? 'Equip failed'));
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
        setNotice('Attribute Points saved! Stat battle otomatis meningkat.');
      } else {
        setNotice(String(res.data?.error ?? 'Failed to save points'));
      }
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
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
    }
  }, [profile, gearCat]);

  const shopItemsForCategory = useMemo(() => {
    if (!profile) return [];
    const gSuffix = profile.gender === 0 ? '_0' : '_1';
    return libraryItems
      .filter((it) => {
        if (it.type !== gearCat) return false;
        if (!it.buyable || it.premium) return false;
        if (it.price_gold <= 0 || it.price_tokens > 0) return false;
        if ((gearCat === 'set' || gearCat === 'hair') && !it.id.endsWith(gSuffix)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.level - b.level || a.price_gold - b.price_gold)
      .slice(0, 40);
  }, [libraryItems, gearCat, profile]);

  if (!profile) return null;

  const hasUnsavedPoints =
    draftPoints.free !== profile.points.free ||
    draftPoints.wind !== profile.points.wind ||
    draftPoints.fire !== profile.points.fire ||
    draftPoints.lightning !== profile.points.lightning ||
    draftPoints.water !== profile.points.water ||
    draftPoints.earth !== profile.points.earth;

  return (
    <SafeAreaView style={styles.root}>
      {/* Top Bar */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigate('hub')}>
          <Text style={styles.backText}>← Village Hub</Text>
        </Pressable>

        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tabBtn, tab === 'jutsu' && styles.tabBtnActive]}
            onPress={() => setTab('jutsu')}
          >
            <Text style={styles.tabText}>Jutsu ({profile.equippedSkills.length}/6)</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, tab === 'gear' && styles.tabBtnActive]}
            onPress={() => setTab('gear')}
          >
            <Text style={styles.tabText}>Gear & Shop</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, tab === 'stats' && styles.tabBtnActive]}
            onPress={() => setTab('stats')}
          >
            <Text style={styles.tabText}>
              Stats{profile.points.free > 0 ? ` (+${profile.points.free})` : ''}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.goldText}>
          Lv.{profile.level} • {profile.gold.toLocaleString()} G
        </Text>
      </View>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {/* TAB 1: JUTSU & ACADEMY */}
      {tab === 'jutsu' && (
        <View style={styles.body}>
          <View style={styles.leftPane}>
            <Text style={styles.sectionTitle}>Owned Jutsu (Tap Equip/Unequip)</Text>
            <ScrollView>
              {profile.ownedSkills.map((s) => {
                const eq = profile.equippedSkills.includes(s);
                const def = skillsById[s];
                return (
                  <Pressable
                    key={s}
                    style={[styles.itemToggle, eq && styles.itemToggleActive]}
                    onPress={() => handleToggleEquipSkill(s)}
                    disabled={busyId === s}
                  >
                    <Text style={styles.itemBadge}>
                      {eq ? '✓ ' : '+ '}
                      {def ? `${def.name} (${def.cp_cost} CP)` : s}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.rightPane}>
            <Text style={styles.sectionTitle}>Academy Jutsu Shop (Gold)</Text>
            {loading ? (
              <ActivityIndicator color="#F59E0B" />
            ) : (
              <ScrollView contentContainerStyle={styles.shopGrid}>
                {buyableSkills.map((sk) => {
                  const owned = profile.ownedSkills.includes(sk.id);
                  const locked = profile.level < sk.level;
                  return (
                    <View key={sk.id} style={styles.shopCard}>
                      <Text style={styles.skName} numberOfLines={1}>
                        {sk.name}
                      </Text>
                      <Text style={styles.skMeta}>
                        Lv.{sk.level} • Dmg {sk.damage} • {sk.cp_cost} CP
                      </Text>
                      <Pressable
                        style={[
                          styles.buyBtn,
                          owned && styles.ownedBtn,
                          !owned && locked && styles.lockedBtn,
                        ]}
                        disabled={owned || locked || busyId === sk.id}
                        onPress={() => handleBuySkill(sk)}
                      >
                        <Text style={styles.buyText}>
                          {owned
                            ? 'Owned'
                            : locked
                              ? `Req Lv.${sk.level}`
                              : busyId === sk.id
                                ? '...'
                                : `Learn (${sk.price_gold} G)`}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      )}

      {/* TAB 2: GEAR & SHOP */}
      {tab === 'gear' && (
        <View style={styles.gearWrap}>
          <View style={styles.catRow}>
            {GEAR_CATEGORIES.map((c) => (
              <Pressable
                key={c.key}
                style={[styles.catChip, gearCat === c.key && styles.catChipActive]}
                onPress={() => setGearCat(c.key)}
              >
                <Text style={styles.catChipText}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.body}>
            <View style={styles.leftPane}>
              <Text style={styles.sectionTitle}>Owned (Tap to Equip)</Text>
              <ScrollView>
                {ownedForCategory.map((id) => {
                  const eq = equippedForCategory === id;
                  const def = itemsById[id];
                  return (
                    <Pressable
                      key={id}
                      style={[styles.itemToggle, eq && styles.itemToggleActive]}
                      onPress={() => handleEquipGear(gearCat, id)}
                      disabled={eq || busyId === id}
                    >
                      <Text style={styles.itemBadge} numberOfLines={1}>
                        {eq ? '★ ' : '○ '}
                        {def ? def.name : id}
                      </Text>
                      {def && def.damage > 0 && (
                        <Text style={styles.subMeta}>+{def.damage} Dmg</Text>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.rightPane}>
              <Text style={styles.sectionTitle}>Ninja Shop (Gold)</Text>
              {loading ? (
                <ActivityIndicator color="#F59E0B" />
              ) : (
                <ScrollView contentContainerStyle={styles.shopGrid}>
                  {shopItemsForCategory.map((it) => {
                    const owned = ownedForCategory.includes(it.id);
                    const locked = profile.level < it.level;
                    return (
                      <View key={it.id} style={styles.shopCard}>
                        <Text style={styles.skName} numberOfLines={1}>
                          {it.name}
                        </Text>
                        <Text style={styles.skMeta} numberOfLines={1}>
                          Lv.{it.level}
                          {it.damage > 0 ? ` • +${it.damage} Dmg` : ''}
                        </Text>
                        <Pressable
                          style={[
                            styles.buyBtn,
                            owned && styles.ownedBtn,
                            !owned && locked && styles.lockedBtn,
                          ]}
                          disabled={owned || locked || busyId === it.id}
                          onPress={() => handleBuyGear(it)}
                        >
                          <Text style={styles.buyText}>
                            {owned
                              ? 'Owned'
                              : locked
                                ? `Req Lv.${it.level}`
                                : busyId === it.id
                                  ? '...'
                                  : `Buy (${it.price_gold} G)`}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>
        </View>
      )}

      {/* TAB 3: ELEMENTAL STATS & ATTRIBUTE POINTS */}
      {tab === 'stats' && (
        <View style={styles.statsWrap}>
          <View style={styles.statsHeader}>
            <Text style={styles.sectionTitle}>
              Elemental Attribute Points — Available Free Points: {draftPoints.free}
            </Text>
            <Pressable
              style={[styles.saveBtn, !hasUnsavedPoints && styles.lockedBtn]}
              disabled={!hasUnsavedPoints || busyId === 'save_points'}
              onPress={handleSavePoints}
            >
              <Text style={styles.buyText}>
                {busyId === 'save_points' ? 'Saving...' : 'Save Points'}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.statsList}>
            {STAT_META.map((st) => {
              const val = draftPoints[st.key];
              const baseVal = profile.points[st.key];
              return (
                <View key={st.key} style={styles.statRow}>
                  <View style={styles.statInfo}>
                    <Text style={[styles.statLabel, { color: st.color }]}>
                      {st.label}: {val}
                    </Text>
                    <Text style={styles.statBonus}>{st.bonus}</Text>
                  </View>
                  <View style={styles.statControls}>
                    <Pressable
                      style={[styles.stepBtn, val <= baseVal && styles.lockedBtn]}
                      disabled={val <= baseVal}
                      onPress={() => adjustStat(st.key, -1)}
                    >
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.stepBtn, draftPoints.free <= 0 && styles.lockedBtn]}
                      disabled={draftPoints.free <= 0}
                      onPress={() => adjustStat(st.key, 1)}
                    >
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#070E1A',
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  backBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  backText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tabBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: '#1D4ED8',
    borderColor: '#60A5FA',
  },
  tabText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  goldText: {
    color: '#FACC15',
    fontSize: 12,
    fontWeight: '800',
  },
  notice: {
    color: '#38BDF8',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 6,
  },
  gearWrap: {
    flex: 1,
  },
  catRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  catChip: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  catChipActive: {
    backgroundColor: '#EA580C',
    borderColor: '#FB923C',
  },
  catChipText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  leftPane: {
    flex: 0.78,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 10,
  },
  rightPane: {
    flex: 1.5,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 10,
  },
  sectionTitle: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
  },
  itemToggle: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 5,
  },
  itemToggleActive: {
    backgroundColor: '#4C1D95',
    borderWidth: 1,
    borderColor: '#A78BFA',
  },
  itemBadge: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  subMeta: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 1,
  },
  shopGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 12,
  },
  shopCard: {
    width: '48%',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 8,
  },
  skName: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  skMeta: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },
  buyBtn: {
    marginTop: 6,
    backgroundColor: '#2563EB',
    paddingVertical: 5,
    borderRadius: 6,
    alignItems: 'center',
  },
  ownedBtn: {
    backgroundColor: '#166534',
  },
  lockedBtn: {
    backgroundColor: '#334155',
    opacity: 0.65,
  },
  buyText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  statsWrap: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  saveBtn: {
    backgroundColor: '#16A34A',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 7,
  },
  statsList: {
    gap: 8,
    paddingBottom: 10,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statInfo: {
    flex: 1,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  statBonus: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1,
  },
  statControls: {
    flexDirection: 'row',
    gap: 8,
  },
  stepBtn: {
    width: 34,
    height: 30,
    backgroundColor: '#2563EB',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '900',
  },
});
