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
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileApiClient, type PetCatalogItem } from '../api/client';
import { loadPetsJson, type PetJsonDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
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

export function PetScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [tab, setTab] = useState<'my' | 'shop'>('my');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ownedPets, setOwnedPets] = useState<OwnedPet[]>([]);
  const [catalog, setCatalog] = useState<PetCatalogItem[]>([]);
  const [petsMeta, setPetsMeta] = useState<Record<string, PetJsonDef>>({});
  const [previewSwf, setPreviewSwf] = useState<string>('pet_jyubi');

  const loadAll = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const [petRes, feat, meta] = await Promise.all([
        api.rpc<{ status: number; pets?: OwnedPet[] }>(
          'PetService',
          'getPets',
          [[profile.charId, sessionKey]],
          { sessionKey, charId: profile.charId }
        ),
        api.getFeatureData(),
        loadPetsJson(serverUrl),
      ]);
      const list = petRes.data?.pets ?? [];
      setOwnedPets(list);
      setCatalog(feat.pets_catalog ?? []);
      setPetsMeta(meta);
      if (list.length > 0) {
        setPreviewSwf(list[0].pet_swf || 'pet_jyubi');
      } else if (feat.pets_catalog?.length > 0) {
        setPreviewSwf(feat.pets_catalog[0].swf || feat.pets_catalog[0].pet_id);
      }
    } catch (err) {
      setMessage(`Gagal memuat Pet: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey, serverUrl]);

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
        setMessage(`Berhasil membeli ${pet.name}!`);
        await refreshChar();
        await loadAll();
        setTab('my');
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

  const selectedMeta = petsMeta[previewSwf];

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => { playClickSfx(serverUrl); navigate('hub'); }}>
          <Text style={styles.backText}>← Village Hub</Text>
        </Pressable>
        <Text style={styles.title}>🐾 Pet House ({ownedPets.length} Owned • {catalog.length} Pets)</Text>
        <Text style={styles.currency}>
          Gold: {(profile?.gold ?? 0).toLocaleString()} • Tokens: {(profile?.tokens ?? 0).toLocaleString()}
        </Text>
      </View>

      {message && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{message}</Text>
        </View>
      )}

      <View style={styles.body}>
        {/* Left: Live Animated Pet SWF Preview */}
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>{selectedMeta?.name ?? previewSwf}</Text>
          <View style={styles.stageBox}>
            <RuffleStageView ref={stageRef} baseUrl={serverUrl} />
          </View>
          {selectedMeta && (
            <ScrollView style={styles.metaBox}>
              <Text style={styles.metaStats}>
                AGI {selectedMeta.agility} • DODGE {selectedMeta.dodge}% • CRIT {selectedMeta.critical}%
              </Text>
              <Text style={styles.metaDesc}>{selectedMeta.description}</Text>
              {(selectedMeta.attacks ?? []).slice(0, 4).map((atk, i) => (
                <Text key={i} style={styles.metaSkill}>
                  • Lv.{atk.level} {atk.name}: {atk.description}
                </Text>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Right: Tabs + List */}
        <View style={styles.listPane}>
          <View style={styles.tabRow}>
            <Pressable style={[styles.tabBtn, tab === 'my' && styles.tabActive]} onPress={() => setTab('my')}>
              <Text style={styles.tabText}>My Pets ({ownedPets.length})</Text>
            </Pressable>
            <Pressable style={[styles.tabBtn, tab === 'shop' && styles.tabActive]} onPress={() => setTab('shop')}>
              <Text style={styles.tabText}>Pet Shop ({catalog.length})</Text>
            </Pressable>
            {tab === 'shop' && (
              <TextInput
                style={styles.searchInput}
                placeholder="Cari pet..."
                placeholderTextColor="#64748B"
                value={search}
                onChangeText={setSearch}
              />
            )}
          </View>

          {loading ? (
            <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
          ) : tab === 'my' ? (
            <ScrollView contentContainerStyle={styles.scrollList}>
              {ownedPets.length === 0 ? (
                <Text style={styles.emptyText}>Belum punya Pet. Buka tab Pet Shop untuk membeli!</Text>
              ) : (
                ownedPets.map((p) => {
                  const isEquipped = profile?.equippedPet === p.pet_id;
                  return (
                    <Pressable
                      key={p.pet_id}
                      style={[styles.rowCard, previewSwf === p.pet_swf && styles.rowSelected]}
                      onPress={() => setPreviewSwf(p.pet_swf)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>
                          {p.pet_name} (Lv.{p.pet_level}) {isEquipped ? '⭐ EQUIPPED' : ''}
                        </Text>
                        <Text style={styles.rowSub}>
                          SWF: {p.pet_swf} • XP: {p.pet_xp} • MP: {p.pet_mp}
                        </Text>
                      </View>
                      {isEquipped ? (
                        <Pressable
                          style={[styles.actBtn, { backgroundColor: '#475569' }]}
                          disabled={busyId !== null}
                          onPress={handleUnequip}
                        >
                          <Text style={styles.actBtnText}>Unequip</Text>
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
                })
              )}
            </ScrollView>
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070E1A', padding: 10 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#0F172A', borderRadius: 10, borderWidth: 1, borderColor: '#1E293B',
    paddingHorizontal: 10, paddingVertical: 7, marginBottom: 8,
  },
  backBtn: { backgroundColor: '#1E293B', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  backText: { color: '#F8FAFC', fontSize: 11, fontWeight: '700' },
  title: { color: '#F8FAFC', fontSize: 14, fontWeight: '800' },
  currency: { color: '#FACC15', fontSize: 11, fontWeight: '700' },
  banner: {
    backgroundColor: '#1E293B', borderColor: '#F59E0B', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6,
  },
  bannerText: { color: '#FDE68A', fontSize: 11, fontWeight: '700' },
  body: { flex: 1, flexDirection: 'row', gap: 10 },
  previewCard: {
    width: 240, backgroundColor: '#0F172A', borderRadius: 10,
    borderWidth: 1, borderColor: '#1E293B', padding: 8,
  },
  previewTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  stageBox: { height: 145, backgroundColor: '#111827', borderRadius: 8, overflow: 'hidden' },
  metaBox: { flex: 1, marginTop: 6 },
  metaStats: { color: '#38BDF8', fontSize: 10, fontWeight: '800', marginBottom: 3 },
  metaDesc: { color: '#CBD5E1', fontSize: 10, marginBottom: 4 },
  metaSkill: { color: '#94A3B8', fontSize: 9, marginBottom: 2 },
  listPane: { flex: 1, backgroundColor: '#0F172A', borderRadius: 10, borderWidth: 1, borderColor: '#1E293B', padding: 8 },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  tabBtn: { backgroundColor: '#1E293B', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  tabActive: { backgroundColor: '#EA580C' },
  tabText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  searchInput: {
    flex: 1, backgroundColor: '#070E1A', borderWidth: 1, borderColor: '#334155',
    borderRadius: 6, color: '#F8FAFC', fontSize: 11, paddingHorizontal: 8, paddingVertical: 4,
  },
  scrollList: { gap: 6, paddingBottom: 12 },
  emptyText: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 24 },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#111827',
    borderRadius: 8, borderWidth: 1, borderColor: '#1E293B', padding: 8, gap: 8,
  },
  rowSelected: { borderColor: '#F59E0B' },
  rowTitle: { color: '#F8FAFC', fontSize: 12, fontWeight: '800' },
  rowSub: { color: '#94A3B8', fontSize: 10, marginTop: 2 },
  actBtn: { backgroundColor: '#2563EB', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  actBtnText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
});
