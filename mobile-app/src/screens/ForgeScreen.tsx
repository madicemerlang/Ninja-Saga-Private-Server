import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { MobileApiClient, type BlacksmithRecipeDef } from '../api/client';
import { loadLibraryData, type LibraryItemDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { useAuthStore } from '../store/useAuthStore';

export function ForgeScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Record<string, BlacksmithRecipeDef>>({});
  const [itemsById, setItemsById] = useState<Record<string, LibraryItemDef>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [feat, lib] = await Promise.all([api.getFeatureData(), loadLibraryData(serverUrl)]);
      setRecipes(feat.blacksmith_recipes ?? {});
      setItemsById(lib.itemsById ?? {});
    } catch (err) {
      setMessage(`Gagal memuat Forge: ${String(err)}`);
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
        setMessage(`Berhasil menempa ${itemsById[weaponId]?.name ?? weaponId}!`);
        const raw = await api.getCharacter(profile.charId, sessionKey);
        setProfileFromRaw(profile.charId, raw);
      } else {
        setMessage(res.data?.result || res.data?.error || 'Gagal menempa item.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(recipes).filter(([id]) => {
      if (!q) return true;
      const name = (itemsById[id]?.name ?? id).toLowerCase();
      return name.includes(q) || id.toLowerCase().includes(q);
    });
  }, [recipes, itemsById, search]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => { playClickSfx(serverUrl); navigate('hub'); }}>
          <Text style={styles.backText}>← Village Hub</Text>
        </Pressable>
        <Text style={styles.title}>⚒️ Blacksmith Forge ({Object.keys(recipes).length} Recipes)</Text>
        <Text style={styles.currency}>
          Gold: {(profile?.gold ?? 0).toLocaleString()} • Tokens: {(profile?.tokens ?? 0).toLocaleString()}
        </Text>
      </View>

      {message && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{message}</Text>
        </View>
      )}

      <TextInput
        style={styles.searchInput}
        placeholder="Cari senjata / item forge..."
        placeholderTextColor="#64748B"
        value={search}
        onChangeText={setSearch}
      />

      {loading ? (
        <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {entries.map(([outId, rec]) => {
            const outMeta = itemsById[outId];
            const reqWpn = rec.req_weapon;
            const hasReqWpn = !reqWpn || ownedWeapons.has(reqWpn);
            const matEntries = Object.entries(rec.mats ?? {});
            return (
              <View key={outId} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>
                    {outMeta?.name ?? outId} {outMeta?.level ? `(Lv.${outMeta.level})` : ''}{' '}
                    {outMeta?.damage ? `• DMG ${outMeta.damage}` : ''}
                  </Text>
                  {reqWpn ? (
                    <Text style={[styles.reqLine, hasReqWpn ? styles.okText : styles.missText]}>
                      Base Weapon: {itemsById[reqWpn]?.name ?? reqWpn} ({hasReqWpn ? 'Owned ✓' : 'Missing ✗'})
                    </Text>
                  ) : null}
                  <Text style={styles.matLine}>
                    Materials:{' '}
                    {matEntries
                      .map(([mId, qty]) => {
                        const have = ownedMats[mId] ?? 0;
                        return `${itemsById[mId]?.name ?? mId} (${have}/${qty})`;
                      })
                      .join(' • ') || 'None'}
                  </Text>
                </View>

                <View style={styles.btnCol}>
                  <Pressable
                    style={[styles.forgeBtn, { backgroundColor: '#D97706' }]}
                    disabled={busyId !== null}
                    onPress={() => handleForge(outId, 'gold')}
                  >
                    <Text style={styles.btnText}>
                      {busyId === `${outId}-gold` ? '...' : `${rec.gold.toLocaleString()} G`}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.forgeBtn, { backgroundColor: '#7C3AED' }]}
                    disabled={busyId !== null}
                    onPress={() => handleForge(outId, 'tokens')}
                  >
                    <Text style={styles.btnText}>
                      {busyId === `${outId}-tokens` ? '...' : `${rec.tokens} T`}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
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
  searchInput: {
    backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155',
    borderRadius: 8, color: '#F8FAFC', fontSize: 12, paddingHorizontal: 10, paddingVertical: 6,
    marginBottom: 8,
  },
  list: { gap: 7, paddingBottom: 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A',
    borderRadius: 8, borderWidth: 1, borderColor: '#1E293B', padding: 9, gap: 10,
  },
  itemTitle: { color: '#F8FAFC', fontSize: 12, fontWeight: '800' },
  reqLine: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  okText: { color: '#4ADE80' },
  missText: { color: '#F87171' },
  matLine: { color: '#94A3B8', fontSize: 10, marginTop: 2 },
  btnCol: { flexDirection: 'row', gap: 6 },
  forgeBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6, minWidth: 74, alignItems: 'center' },
  btnText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
});
