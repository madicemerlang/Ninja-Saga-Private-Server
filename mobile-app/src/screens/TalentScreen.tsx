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
import { MobileApiClient, type TalentCatalogItem } from '../api/client';
import { playClickSfx } from '../audio/audioManager';
import { useAuthStore } from '../store/useAuthStore';

interface OwnedTalentSkill {
  item_id: string;
  item_level: number;
  talent_type: string | null;
}

export function TalentScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [tab, setTab] = useState<'my' | 'discover'>('my');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ownedSkills, setOwnedSkills] = useState<OwnedTalentSkill[]>([]);
  const [catalog, setCatalog] = useState<TalentCatalogItem[]>([]);
  const [talentDesc, setTalentDesc] = useState<Record<string, { talent_skill_id?: string }>>({});
  const [tpCosts, setTpCosts] = useState<Record<string, number>>({});

  const loadAll = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const [tsRes, feat] = await Promise.all([
        api.rpc<{ status: number; data?: OwnedTalentSkill[] }>(
          'TalentService',
          'getTalentSkills',
          [profile.charId, sessionKey],
          { sessionKey, charId: profile.charId }
        ),
        api.getFeatureData(),
      ]);
      setOwnedSkills(tsRes.data?.data ?? []);
      setCatalog(feat.talents_catalog ?? []);
      setTalentDesc(feat.talent_description ?? {});
      setTpCosts(feat.talent_tp_cost ?? {});
    } catch (err) {
      setMessage(`Gagal memuat Talent: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshAll = async () => {
    if (!profile || !sessionKey) return;
    const raw = await api.getCharacter(profile.charId, sessionKey);
    setProfileFromRaw(profile.charId, raw);
    await loadAll();
  };

  // Non-skill entries are discoverable talent trees (e.g. 'de', 'dp', 'dm', 'lm', 'sm', 'eightext', etc.)
  const discoverableTrees = useMemo(
    () => catalog.filter((t) => !t.talent_id.startsWith('skill_')),
    [catalog]
  );

  // Map skill_id:level -> catalog info
  const skillInfoByIdLv = useMemo(() => {
    const map: Record<string, TalentCatalogItem> = {};
    for (const t of catalog) {
      if (t.talent_id.startsWith('skill_')) {
        map[t.talent_id] = t;
      }
    }
    return map;
  }, [catalog]);

  // Active character's unlocked talent trees (slot 1 Extreme, slot 2/3 Secret)
  const unlockedTrees = useMemo(
    () => [profile?.talent1, profile?.talent2, profile?.talent3].filter((v): v is string => Boolean(v)),
    [profile?.talent1, profile?.talent2, profile?.talent3]
  );

  // Skills belonging to unlocked trees (from talent_description)
  const availableTreeSkills = useMemo(() => {
    const ownedMap: Record<string, number> = {};
    for (const os of ownedSkills) {
      ownedMap[os.item_id] = os.item_level;
    }
    const list: Array<{ baseSkillId: string; tree: string; level: number; name: string; desc: string }> = [];
    for (const [key, info] of Object.entries(talentDesc)) {
      const m = key.match(/^talent_(.+)_skill_\d+$/);
      if (!m || !info?.talent_skill_id) continue;
      const tree = m[1];
      if (!unlockedTrees.includes(tree)) continue;
      const baseId = info.talent_skill_id;
      const curLv = ownedMap[baseId] ?? 0;
      const lookup = skillInfoByIdLv[`${baseId}:${Math.max(1, curLv)}`] ?? skillInfoByIdLv[`${baseId}:1`];
      list.push({
        baseSkillId: baseId,
        tree,
        level: curLv,
        name: lookup?.name ?? baseId,
        desc: lookup?.description ?? '',
      });
    }
    return list;
  }, [talentDesc, unlockedTrees, ownedSkills, skillInfoByIdLv]);

  const handleDiscover = async (tree: TalentCatalogItem, mode: 'Extreme' | 'Secret') => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(`disc-${tree.talent_id}`);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'TalentService',
        'discoverTalent',
        [profile.charId, sessionKey, mode, tree.talent_id],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage(`Talent ${tree.name} berhasil dibuka (${mode})!`);
        await refreshAll();
        setTab('my');
      } else {
        setMessage(res.data?.result || res.data?.error || 'Gagal membuka talent.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleUpgrade = async (baseSkillId: string, isMax: boolean) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(`up-${baseSkillId}`);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'TalentService',
        'upgradeSkill',
        [profile.charId, sessionKey, baseSkillId, isMax],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage(res.data?.result || 'Talent skill berhasil di-upgrade!');
        await refreshAll();
      } else {
        setMessage(res.data?.result || res.data?.error || 'TP tidak cukup.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => { playClickSfx(serverUrl); navigate('hub'); }}>
          <Text style={styles.backText}>← Village Hub</Text>
        </Pressable>
        <Text style={styles.title}>✨ Talent Hall (Extreme & Secret)</Text>
        <Text style={styles.currency}>
          TP: {(profile?.tp ?? 0).toLocaleString()} • Gold: {(profile?.gold ?? 0).toLocaleString()} • Tokens: {(profile?.tokens ?? 0).toLocaleString()}
        </Text>
      </View>

      {message && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{message}</Text>
        </View>
      )}

      {/* Equipped Talent Slots Bar */}
      <View style={styles.slotsRow}>
        <View style={styles.slotBox}>
          <Text style={styles.slotLabel}>EXTREME SLOT</Text>
          <Text style={styles.slotVal}>{profile?.talent1 || 'Empty'}</Text>
        </View>
        <View style={styles.slotBox}>
          <Text style={styles.slotLabel}>SECRET SLOT 1</Text>
          <Text style={styles.slotVal}>{profile?.talent2 || 'Empty'}</Text>
        </View>
        <View style={styles.slotBox}>
          <Text style={styles.slotLabel}>SECRET SLOT 2</Text>
          <Text style={styles.slotVal}>{profile?.talent3 || 'Empty'}</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <Pressable style={[styles.tabBtn, tab === 'my' && styles.tabActive]} onPress={() => setTab('my')}>
          <Text style={styles.tabText}>Upgrade Skills ({availableTreeSkills.length})</Text>
        </Pressable>
        <Pressable style={[styles.tabBtn, tab === 'discover' && styles.tabActive]} onPress={() => setTab('discover')}>
          <Text style={styles.tabText}>Discover Talents ({discoverableTrees.length})</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
      ) : tab === 'my' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {availableTreeSkills.length === 0 ? (
            <Text style={styles.emptyText}>
              Belum ada Talent terbuka. Buka tab Discover Talents untuk membuka Extreme / Secret Talent!
            </Text>
          ) : (
            availableTreeSkills.map((sk) => {
              const nextLv = sk.level + 1;
              const nextCost = tpCosts[String(nextLv)] ?? 5;
              const isMaxed = sk.level >= 10;
              return (
                <View key={sk.baseSkillId} style={styles.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>
                      {sk.name} [{sk.tree.toUpperCase()}] — Lv.{sk.level}/10
                    </Text>
                    <Text style={styles.cardDesc}>{sk.desc || sk.baseSkillId}</Text>
                  </View>
                  {isMaxed ? (
                    <Text style={styles.maxBadge}>MAX</Text>
                  ) : (
                    <View style={styles.btnRow}>
                      <Pressable
                        style={styles.upBtn}
                        disabled={busyId !== null}
                        onPress={() => handleUpgrade(sk.baseSkillId, false)}
                      >
                        <Text style={styles.btnText}>+1 ({nextCost} TP)</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.upBtn, { backgroundColor: '#7C3AED' }]}
                        disabled={busyId !== null}
                        onPress={() => handleUpgrade(sk.baseSkillId, true)}
                      >
                        <Text style={styles.btnText}>MAX</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {discoverableTrees.map((t) => {
            const unlocked = unlockedTrees.includes(t.talent_id);
            return (
              <View key={t.talent_id} style={[styles.card, unlocked && styles.cardUnlocked]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {t.name} ({t.talent_id}) {t.is_emblem ? '👑' : ''}
                  </Text>
                  <Text style={styles.cardDesc}>{t.description || 'Secret Ninja Talent.'}</Text>
                  <Text style={styles.costText}>
                    {t.price_gold > 0 ? `${t.price_gold.toLocaleString()} Gold` : ''}
                    {t.price_gold > 0 && t.price_tokens > 0 ? ' • ' : ''}
                    {t.price_tokens > 0 ? `${t.price_tokens.toLocaleString()} Tokens` : ''}
                  </Text>
                </View>
                {unlocked ? (
                  <Text style={styles.maxBadge}>UNLOCKED ✓</Text>
                ) : (
                  <View style={styles.btnRow}>
                    <Pressable
                      style={[styles.upBtn, { backgroundColor: '#D97706' }]}
                      disabled={busyId !== null}
                      onPress={() => handleDiscover(t, 'Extreme')}
                    >
                      <Text style={styles.btnText}>Extreme</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.upBtn, { backgroundColor: '#2563EB' }]}
                      disabled={busyId !== null}
                      onPress={() => handleDiscover(t, 'Secret')}
                    >
                      <Text style={styles.btnText}>Secret</Text>
                    </Pressable>
                  </View>
                )}
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
  slotsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  slotBox: {
    flex: 1, backgroundColor: '#0F172A', borderRadius: 8,
    borderWidth: 1, borderColor: '#334155', padding: 6, alignItems: 'center',
  },
  slotLabel: { color: '#94A3B8', fontSize: 9, fontWeight: '800' },
  slotVal: { color: '#38BDF8', fontSize: 12, fontWeight: '900', marginTop: 2 },
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  tabBtn: { backgroundColor: '#1E293B', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  tabActive: { backgroundColor: '#7C3AED' },
  tabText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  list: { gap: 7, paddingBottom: 16 },
  emptyText: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 24 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A',
    borderRadius: 8, borderWidth: 1, borderColor: '#1E293B', padding: 9, gap: 10,
  },
  cardUnlocked: { borderColor: '#22C55E' },
  cardTitle: { color: '#F8FAFC', fontSize: 12, fontWeight: '800' },
  cardDesc: { color: '#CBD5E1', fontSize: 10, marginTop: 2 },
  costText: { color: '#FACC15', fontSize: 10, fontWeight: '700', marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 6 },
  upBtn: { backgroundColor: '#16A34A', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  btnText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  maxBadge: { color: '#4ADE80', fontSize: 11, fontWeight: '900' },
});
