import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MobileApiClient, type PetCatalogItem } from '../api/client';
import { loadPetsJson, type PetJsonDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { buildSwfAssetUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

interface OwnedPet {
  pet_id: number;
  pet_name: string;
  pet_level: number;
  pet_xp: number;
  pet_mp: number;
  pet_swf: string;
  pet_skills: string;
}

interface PetScreenProps {
  mode: 'my' | 'shop';
}

export function PetScreen({ mode }: PetScreenProps) {
  const stageRef = useRef<RuffleStageHandle>(null);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ownedPets, setOwnedPets] = useState<OwnedPet[]>([]);
  const [selectedOwnedId, setSelectedOwnedId] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<PetCatalogItem[]>([]);
  const [petsMeta, setPetsMeta] = useState<Record<string, PetJsonDef>>({});
  const [previewSwf, setPreviewSwf] = useState<string>('pet_jyubi');

  const isMyMode = mode === 'my';

  const loadAll = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      if (isMyMode) {
        const [petRes, meta] = await Promise.all([
          api.rpc<{ status: number; pets?: OwnedPet[] }>(
            'PetService',
            'getPets',
            [[profile.charId, sessionKey]],
            { sessionKey, charId: profile.charId }
          ),
          loadPetsJson(serverUrl),
        ]);
        const list = petRes.data?.pets ?? [];
        setOwnedPets(list);
        setPetsMeta(meta);
        if (list.length > 0) {
          setSelectedOwnedId((prev) => {
            const exists = list.some((p) => p.pet_id === prev);
            const target = exists
              ? list.find((p) => p.pet_id === prev)!
              : list.find((p) => p.pet_id === profile.equippedPet) ?? list[0];
            setPreviewSwf(target.pet_swf || 'pet_jyubi');
            return target.pet_id;
          });
        } else {
          setSelectedOwnedId(null);
        }
      } else {
        const [feat, meta] = await Promise.all([
          api.getFeatureData(),
          loadPetsJson(serverUrl),
        ]);
        const shopList = feat.pets_catalog ?? [];
        setCatalog(shopList);
        setPetsMeta(meta);
        if (shopList.length > 0) {
          setPreviewSwf(shopList[0].swf || shopList[0].pet_id);
        }
      }
    } catch (err) {
      setMessage(`Gagal memuat Pet: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey, serverUrl, isMyMode]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!previewSwf) return;
    const t = setTimeout(() => {
      stageRef.current?.loadSwf(buildSwfAssetUrl(serverUrl, 'pets', previewSwf, 'standby'));
    }, 250);
    return () => clearTimeout(t);
  }, [serverUrl, previewSwf]);

  const refreshChar = async () => {
    if (!profile || !sessionKey) return;
    const raw = await api.getCharacter(profile.charId, sessionKey);
    setProfileFromRaw(profile.charId, raw);
  };

  const handleEquip = async (petInstanceId: number) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(`eq-${petInstanceId}`);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'PetService',
        'equipPet',
        [[profile.charId, sessionKey, petInstanceId]],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage('Pet berhasil di-equip!');
        await refreshChar();
        await loadAll();
      } else {
        setMessage(res.data?.result || res.data?.error || 'Gagal equip pet.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleUnequip = async () => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId('unequip');
    setMessage(null);
    try {
      await api.rpc('PetService', 'unequipPet', [[profile.charId, sessionKey]], {
        sessionKey,
        charId: profile.charId,
      });
      setMessage('Pet dilepas.');
      await refreshChar();
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleLearnSkill = async (pet: OwnedPet, skillIndex: number) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(`learn-${pet.pet_id}-${skillIndex}`);
    setMessage(null);
    try {
      const res = await api.rpc<{
        status: number;
        result?: string;
        error?: string;
        pet_skills?: string;
      }>(
        'PetService',
        'learnPetSkill',
        [[profile.charId, sessionKey, pet.pet_id, skillIndex]],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage(res.data.result || 'Jurus pet berhasil dipelajari!');
        await refreshChar();
        await loadAll();
      } else {
        setMessage(res.data?.result || res.data?.error || 'Gagal mempelajari jurus pet.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleBuy = async (pet: PetCatalogItem) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(`buy-${pet.pet_id}`);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'PetService',
        'buyPet',
        [[profile.charId, sessionKey, pet.pet_id]],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage(`Berhasil membeli ${pet.name}! Cek di menu Pet untuk equip & pelajari jurus.`);
        await refreshChar();
      } else if (res.data?.status === 6) {
        setMessage(`${pet.name} membutuhkan Emblem / Premium.`);
      } else {
        setMessage(res.data?.result || res.data?.error || 'Gold/Token tidak cukup.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const filteredShop = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? catalog.filter((p) => p.name.toLowerCase().includes(q) || p.pet_id.toLowerCase().includes(q))
      : catalog;
    return list.slice(0, 80);
  }, [catalog, search]);

  const selectedOwned = useMemo(
    () => ownedPets.find((p) => p.pet_id === selectedOwnedId) ?? ownedPets[0] ?? null,
    [ownedPets, selectedOwnedId]
  );

  const selectedMeta = petsMeta[previewSwf];
  const learnedFlags = useMemo(() => {
    const raw = selectedOwned?.pet_skills || '1,0,0,0,0,0';
    return raw.split(',').map((v) => v.trim() === '1');
  }, [selectedOwned]);

  return (
    <NinjaScrollWindow
      title={isMyMode ? `My Pets (${ownedPets.length})` : 'Pet Shop'}
      bgSource={BUILDING_BGS.petShop}
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
      {message && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{message}</Text>
        </View>
      )}

      <View style={styles.body}>
        {/* Left: Live Animated Pet SWF Preview */}
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>
            {isMyMode && selectedOwned
              ? `${selectedOwned.pet_name} (Lv.${selectedOwned.pet_level})`
              : selectedMeta?.name ?? previewSwf}
          </Text>
          <View style={styles.stageBox}>
            <RuffleStageView ref={stageRef} baseUrl={serverUrl} />
          </View>
          {selectedMeta && (
            <ScrollView style={styles.metaBox}>
              <Text style={styles.metaStats}>
                AGI {selectedMeta.agility} • DODGE {selectedMeta.dodge}% • CRIT {selectedMeta.critical}%
              </Text>
              <Text style={styles.metaDesc}>{selectedMeta.description}</Text>
              {!isMyMode &&
                (selectedMeta.attacks ?? []).slice(0, 6).map((atk, i) => (
                  <Text key={i} style={styles.metaSkill}>
                    • Lv.{atk.level} {atk.name}: {atk.description}
                  </Text>
                ))}
            </ScrollView>
          )}
        </View>

        {/* Right: Mode-Specific Pane */}
        {isMyMode ? (
          <View style={styles.mySplitPane}>
            <View style={styles.ownedCol}>
              <Text style={styles.sectionHeader}>Daftar Pet Dimiliki</Text>
              {loading ? (
                <ActivityIndicator color={NS_THEME.btnOrange} style={{ marginTop: 24 }} />
              ) : ownedPets.length === 0 ? (
                <Text style={styles.emptyText}>
                  Belum punya Pet. Kunjungi bangunan Pet Shop di desa untuk membeli!
                </Text>
              ) : (
                <ScrollView contentContainerStyle={styles.scrollList}>
                  {ownedPets.map((p) => {
                    const isEquipped = profile?.equippedPet === p.pet_id;
                    const isSelected = selectedOwned?.pet_id === p.pet_id;
                    return (
                      <Pressable
                        key={p.pet_id}
                        style={[styles.rowCard, isSelected && styles.rowSelected]}
                        onPress={() => {
                          setSelectedOwnedId(p.pet_id);
                          setPreviewSwf(p.pet_swf);
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>
                            {p.pet_name} (Lv.{p.pet_level}) {isEquipped ? '⭐' : ''}
                          </Text>
                          <Text style={styles.rowSub}>
                            XP: {p.pet_xp} • MP: {p.pet_mp}
                          </Text>
                        </View>
                        {isEquipped ? (
                          <Pressable
                            style={[styles.actBtn, { backgroundColor: '#475569' }]}
                            disabled={busyId !== null}
                            onPress={handleUnequip}
                          >
                            <Text style={styles.actBtnText}>
                              {busyId === 'unequip' ? '...' : 'Unequip'}
                            </Text>
                          </Pressable>
                        ) : (
                          <Pressable
                            style={styles.actBtn}
                            disabled={busyId !== null}
                            onPress={() => handleEquip(p.pet_id)}
                          >
                            <Text style={styles.actBtnText}>
                              {busyId === `eq-${p.pet_id}` ? '...' : 'Equip'}
                            </Text>
                          </Pressable>
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            <View style={styles.skillsCol}>
              <Text style={styles.sectionHeader}>
                Jurus Pet {selectedOwned ? `— ${selectedOwned.pet_name}` : ''}
              </Text>
              {!selectedOwned ? (
                <Text style={styles.emptyText}>Pilih pet untuk melihat & mempelajari jurusnya.</Text>
              ) : (
                <ScrollView contentContainerStyle={styles.scrollList}>
                  {(selectedMeta?.attacks ?? []).slice(0, 6).map((atk, idx) => {
                    const isLearned = learnedFlags[idx] === true;
                    const reqLevel = Math.max(1, atk.level ?? 1);
                    const canLearnLevel = selectedOwned.pet_level >= reqLevel;
                    const goldCost = Math.max(500, reqLevel * 500);
                    const learnBusy = busyId === `learn-${selectedOwned.pet_id}-${idx}`;

                    return (
                      <View
                        key={idx}
                        style={[styles.skillCard, isLearned && styles.skillCardLearned]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>
                            {atk.name} <Text style={styles.skillLvTag}>(Lv.{reqLevel})</Text>
                          </Text>
                          <Text style={styles.rowSub} numberOfLines={2}>
                            {atk.description} • CD {atk.cooldown}
                          </Text>
                        </View>
                        {isLearned ? (
                          <View style={styles.learnedBadge}>
                            <Text style={styles.learnedBadgeTxt}>✓ Dipelajari</Text>
                          </View>
                        ) : (
                          <Pressable
                            style={[
                              styles.learnBtn,
                              !canLearnLevel && styles.learnBtnLocked,
                            ]}
                            disabled={busyId !== null || !canLearnLevel}
                            onPress={() => handleLearnSkill(selectedOwned, idx)}
                          >
                            <Text style={styles.actBtnText}>
                              {learnBusy
                                ? '...'
                                : canLearnLevel
                                  ? `Pelajari (${goldCost.toLocaleString()}G)`
                                  : `Butuh Lv.${reqLevel}`}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.listPane}>
            <View style={styles.tabRow}>
              <Text style={styles.sectionHeader}>Katalog Beli Pet</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Cari pet..."
                placeholderTextColor={NS_THEME.inkSoft}
                value={search}
                onChangeText={setSearch}
              />
            </View>

            {loading ? (
              <ActivityIndicator color={NS_THEME.btnOrange} style={{ marginTop: 24 }} />
            ) : (
              <ScrollView contentContainerStyle={styles.scrollList}>
                {filteredShop.map((pet) => (
                  <Pressable
                    key={pet.pet_id}
                    style={[styles.rowCard, previewSwf === pet.swf && styles.rowSelected]}
                    onPress={() => setPreviewSwf(pet.swf)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        {pet.name} {pet.premium ? '👑' : ''}
                      </Text>
                      <Text style={styles.rowSub}>
                        {pet.price_gold > 0 ? `${pet.price_gold.toLocaleString()} Gold` : ''}
                        {pet.price_gold > 0 && pet.price_tokens > 0 ? ' • ' : ''}
                        {pet.price_tokens > 0 ? `${pet.price_tokens.toLocaleString()} Tokens` : ''}
                        {pet.price_gold === 0 && pet.price_tokens === 0 ? 'Event / Special' : ''}
                      </Text>
                    </View>
                    <Pressable
                      style={[styles.actBtn, { backgroundColor: '#16A34A' }]}
                      disabled={busyId !== null}
                      onPress={() => handleBuy(pet)}
                    >
                      <Text style={styles.actBtnText}>
                        {busyId === `buy-${pet.pet_id}` ? '...' : 'Buy'}
                      </Text>
                    </Pressable>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  currencyPill: {
    backgroundColor: '#3E2008', borderRadius: 8, borderWidth: 1.5, borderColor: NS_THEME.goldTrim,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  currencyTxt: { color: '#FDE047', fontSize: 10.5, fontWeight: '900' },
  banner: {
    backgroundColor: '#FEF3C7', borderColor: '#B45309', borderWidth: 1.5,
    borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6,
  },
  bannerText: { color: '#78350F', fontSize: 11, fontWeight: '800' },
  body: { flex: 1, flexDirection: 'row', gap: 10 },
  previewCard: {
    width: 215, backgroundColor: NS_THEME.parchmentCard, borderRadius: 10,
    borderWidth: 1.5, borderColor: NS_THEME.woodBorder, padding: 8,
  },
  previewTitle: { color: NS_THEME.inkDark, fontSize: 12.5, fontWeight: '900', marginBottom: 4 },
  stageBox: {
    height: 135, backgroundColor: NS_THEME.stageDark, borderRadius: 8,
    borderWidth: 1.5, borderColor: NS_THEME.woodBorder, overflow: 'hidden',
  },
  metaBox: { flex: 1, marginTop: 6 },
  metaStats: { color: '#B45309', fontSize: 10, fontWeight: '900', marginBottom: 3 },
  metaDesc: { color: NS_THEME.inkMid, fontSize: 10, fontWeight: '600', marginBottom: 4 },
  metaSkill: { color: NS_THEME.inkSoft, fontSize: 9, fontWeight: '700', marginBottom: 2 },
  listPane: {
    flex: 1, backgroundColor: NS_THEME.parchmentCardAlt, borderRadius: 10,
    borderWidth: 1.5, borderColor: NS_THEME.woodBorder, padding: 8,
  },
  mySplitPane: { flex: 1, flexDirection: 'row', gap: 8 },
  ownedCol: {
    flex: 1, backgroundColor: NS_THEME.parchmentCardAlt, borderRadius: 10,
    borderWidth: 1.5, borderColor: NS_THEME.woodBorder, padding: 8,
  },
  skillsCol: {
    flex: 1.15, backgroundColor: NS_THEME.parchmentCardAlt, borderRadius: 10,
    borderWidth: 1.5, borderColor: NS_THEME.woodBorder, padding: 8,
  },
  sectionHeader: {
    color: NS_THEME.inkDark, fontSize: 11.5, fontWeight: '900', marginBottom: 6,
  },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  searchInput: {
    flex: 1, backgroundColor: '#FFF7E0', borderWidth: 1.5, borderColor: NS_THEME.woodBorder,
    borderRadius: 6, color: NS_THEME.inkDark, fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4,
  },
  scrollList: { gap: 6, paddingBottom: 12 },
  emptyText: { color: NS_THEME.inkMid, fontSize: 11.5, fontWeight: '700', textAlign: 'center', marginTop: 24 },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8, borderWidth: 1.5, borderColor: NS_THEME.woodBorder, padding: 8, gap: 8,
  },
  rowSelected: { borderColor: NS_THEME.btnOrange, backgroundColor: NS_THEME.parchmentSelected, borderWidth: 2 },
  skillCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8, borderWidth: 1.5, borderColor: NS_THEME.woodBorder, padding: 8, gap: 8,
  },
  skillCardLearned: {
    borderColor: NS_THEME.btnGreen,
    backgroundColor: '#E7F6E5',
  },
  skillLvTag: { color: '#B45309', fontSize: 10, fontWeight: '900' },
  rowTitle: { color: NS_THEME.inkDark, fontSize: 11.5, fontWeight: '900' },
  rowSub: { color: NS_THEME.inkSoft, fontSize: 9.5, fontWeight: '700', marginTop: 2 },
  actBtn: {
    backgroundColor: NS_THEME.btnBlue, borderWidth: 1.5, borderColor: NS_THEME.woodBorderDark,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
  },
  learnBtn: {
    backgroundColor: NS_THEME.btnOrange, borderWidth: 1.5, borderColor: NS_THEME.woodBorderDark,
    paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6,
  },
  learnBtnLocked: { backgroundColor: NS_THEME.btnDisabled, opacity: 0.75 },
  learnedBadge: {
    backgroundColor: '#DCFCE7', borderWidth: 1.5, borderColor: NS_THEME.btnGreen,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  learnedBadgeTxt: { color: '#15803D', fontSize: 10, fontWeight: '900' },
  actBtnText: { color: '#FFF', fontSize: 10, fontWeight: '900' },
});
