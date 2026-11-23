import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { loadGameData, type SkillDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { useAuthStore } from '../store/useAuthStore';

const ELEM_TABS = ['fire', 'wind', 'thunder', 'earth', 'water', 'genjutsu'] as const;

export function AdvanceAcademyScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [elem, setElem] = useState<string>('fire');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [chains, setChains] = useState<Record<string, Record<string, string[]>>>({});
  const [skillsById, setSkillsById] = useState<Record<string, SkillDef>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [feat, gd] = await Promise.all([api.getFeatureData(), loadGameData(serverUrl)]);
      setChains(feat.academy_chains ?? {});
      setSkillsById(gd.skillsById ?? {});
    } catch (err) {
      setMessage(`Gagal memuat Advance Academy: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, serverUrl]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const ownedSet = useMemo(() => new Set(profile?.ownedSkills ?? []), [profile?.ownedSkills]);

  const handleUpgrade = async (nextSkillId: string) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(nextSkillId);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'AdvanceAcademyService',
        'upgradeSkill',
        [profile.charId, sessionKey, nextSkillId],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        const skName = skillsById[nextSkillId]?.name ?? nextSkillId;
        setMessage(`Berhasil upgrade ke ${skName}!`);
        const raw = await api.getCharacter(profile.charId, sessionKey);
        setProfileFromRaw(profile.charId, raw);
      } else {
        setMessage(res.data?.result || res.data?.error || 'Upgrade gagal.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const currentChains = chains[elem] ?? {};

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => { playClickSfx(serverUrl); navigate('hub'); }}>
          <Text style={styles.backText}>← Village Hub</Text>
        </Pressable>
        <Text style={styles.title}>📜 Advance Academy (Jutsu Upgrade)</Text>
        <Text style={styles.currency}>
          Lv.{profile?.level ?? 1} • Gold: {(profile?.gold ?? 0).toLocaleString()} • Tokens: {(profile?.tokens ?? 0).toLocaleString()}
        </Text>
      </View>

      {message && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{message}</Text>
        </View>
      )}

      <View style={styles.tabRow}>
        {ELEM_TABS.map((el) => (
          <Pressable
            key={el}
            style={[styles.tabBtn, elem === el && styles.tabActive]}
            onPress={() => { playClickSfx(serverUrl); setElem(el); }}
          >
            <Text style={styles.tabText}>{el.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {Object.entries(currentChains).length === 0 ? (
            <Text style={styles.emptyText}>Tidak ada chain upgrade untuk elemen {elem}.</Text>
          ) : (
            Object.entries(currentChains).map(([chainName, skillIds]) => (
              <View key={chainName} style={styles.chainCard}>
                <Text style={styles.chainTitle}>{chainName.replace(/_/g, ' ').toUpperCase()}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tierRow}>
                  {skillIds.map((sid, idx) => {
                    const sk = skillsById[sid];
                    const owned = ownedSet.has(sid);
                    const prevOwned = idx === 0 || ownedSet.has(skillIds[idx - 1]);
                    const canUpgrade = !owned && prevOwned;
                    return (
                      <View
                        key={sid}
                        style={[
                          styles.tierBox,
                          owned && styles.tierOwned,
                          canUpgrade && styles.tierReady,
                        ]}
                      >
                        <Text style={styles.tierName} numberOfLines={1}>
                          T{idx + 1}: {sk?.name ?? sid}
                        </Text>
                        <Text style={styles.tierMeta}>
                          Lv.{sk?.level ?? 1} • DMG {sk?.damage ?? 0} • CP {sk?.cp_cost ?? 0}
                        </Text>
                        <Text style={styles.tierCost}>
                          {sk?.price_gold ? `${sk.price_gold.toLocaleString()}G` : ''}
                          {sk?.price_tokens ? ` ${sk.price_tokens}T` : ''}
                        </Text>
                        {owned ? (
                          <Text style={styles.ownedTag}>✓ OWNED</Text>
                        ) : (
                          <Pressable
                            style={[styles.upBtn, !canUpgrade && styles.upBtnDisabled]}
                            disabled={!canUpgrade || busyId !== null}
                            onPress={() => handleUpgrade(sid)}
                          >
                            <Text style={styles.upBtnText}>
                              {busyId === sid ? '...' : canUpgrade ? 'Upgrade' : 'Locked'}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            ))
          )}
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
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  tabBtn: { backgroundColor: '#1E293B', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  tabActive: { backgroundColor: '#EA580C' },
  tabText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  list: { gap: 8, paddingBottom: 16 },
  emptyText: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 24 },
  chainCard: {
    backgroundColor: '#0F172A', borderRadius: 10, borderWidth: 1, borderColor: '#1E293B', padding: 8,
  },
  chainTitle: { color: '#38BDF8', fontSize: 11, fontWeight: '900', marginBottom: 6 },
  tierRow: { gap: 8 },
  tierBox: {
    width: 155, backgroundColor: '#111827', borderRadius: 8,
    borderWidth: 1, borderColor: '#334155', padding: 7, justifyContent: 'space-between',
  },
  tierOwned: { borderColor: '#22C55E', backgroundColor: '#052E16' },
  tierReady: { borderColor: '#F59E0B' },
  tierName: { color: '#F8FAFC', fontSize: 11, fontWeight: '800' },
  tierMeta: { color: '#94A3B8', fontSize: 9, marginTop: 2 },
  tierCost: { color: '#FACC15', fontSize: 9, fontWeight: '700', marginTop: 2 },
  ownedTag: { color: '#4ADE80', fontSize: 10, fontWeight: '900', marginTop: 6, textAlign: 'center' },
  upBtn: { backgroundColor: '#EA580C', borderRadius: 5, paddingVertical: 4, marginTop: 6, alignItems: 'center' },
  upBtnDisabled: { backgroundColor: '#334155', opacity: 0.5 },
  upBtnText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
});
