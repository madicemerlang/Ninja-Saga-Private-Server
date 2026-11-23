import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { loadLibraryData, type LibraryItemDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { buildSwfAssetUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

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
  const [badges, setBadges] = useState(0);
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [zones, setZones] = useState<HuntingZone[]>([]);
  const [bosses, setBosses] = useState<Record<string, HuntingBossInfo>>({});
  const [forgeItems, setForgeItems] = useState<HuntingForgeItem[]>([]);
  const [itemsById, setItemsById] = useState<Record<string, LibraryItemDef>>({});
  const [previewBoss, setPreviewBoss] = useState<string>('ene_81');

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
      setMessage(`Gagal memuat Hunting House: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey, serverUrl]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!previewBoss) return;
    const t = setTimeout(() => {
      stageRef.current?.loadSwf(buildSwfAssetUrl(serverUrl, 'enemy', previewBoss, 'standby'));
    }, 250);
    return () => clearTimeout(t);
  }, [serverUrl, previewBoss]);

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
        setMessage('Kari Badge harian berhasil diklaim!');
        await loadAll();
      } else {
        setMessage(res.data?.result || 'Sudah diklaim hari ini.');
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
      setMessage(`Gagal memulai hunt: ${String(err)}`);
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
        setMessage(`Berhasil forge ${itemsById[itemId]?.name ?? itemId}!`);
        const raw = await api.getCharacter(profile.charId, sessionKey);
        setProfileFromRaw(profile.charId, raw);
        await loadAll();
      } else {
        setMessage(res.data?.result || 'Material tidak cukup.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => { playClickSfx(serverUrl); navigate('hub'); }}>
          <Text style={styles.backText}>← Village Hub</Text>
        </Pressable>
        <Text style={styles.title}>🏹 Hunting House</Text>
        <View style={styles.badgeRow}>
          <Text style={styles.badgeCount}>🏅 Kari Badges: {badges}</Text>
          <Pressable
            style={[styles.claimBtn, (dailyClaimed || busy !== null) && styles.disabledBtn]}
            disabled={dailyClaimed || busy !== null}
            onPress={handleDailyClaim}
          >
            <Text style={styles.claimText}>{dailyClaimed ? 'Claimed ✓' : 'Daily Badge'}</Text>
          </Pressable>
        </View>
      </View>

      {message && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{message}</Text>
        </View>
      )}

      <View style={styles.body}>
        {/* Left: Live Ruffle Boss SWF Preview */}
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>{bosses[previewBoss]?.name ?? previewBoss}</Text>
          <View style={styles.stageBox}>
            <RuffleStageView ref={stageRef} baseUrl={serverUrl} />
          </View>
          <Text style={styles.previewDesc}>
            {bosses[previewBoss]?.description ?? 'Boss legendaris Hunting House.'}
          </Text>
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
            <ScrollView contentContainerStyle={styles.scrollList}>
              {zones.map((z, idx) => {
                const bossIds = z.hardBoss ?? z.easyBoss ?? [];
                const isHard = Boolean(z.hardBoss);
                const names = bossIds.map((id) => bosses[id]?.name ?? id).join(' & ');
                return (
                  <Pressable
                    key={idx}
                    style={[styles.rowCard, bossIds.includes(previewBoss) && styles.rowSelected]}
                    onPress={() => bossIds[0] && setPreviewBoss(bossIds[0])}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        Zone {idx + 1} ({isHard ? 'HARD • 2 Boss' : 'EASY • 1 Boss'}): {names}
                      </Text>
                      <Text style={styles.rowSub}>
                        Reward: Kari Badge + XP + Gold • Enemies: {bossIds.join(', ')}
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
            <ScrollView contentContainerStyle={styles.scrollList}>
              {forgeItems.slice(0, 60).map((fi) => {
                const meta = itemsById[fi.item];
                const reqText = fi.requirements.materials
                  .map((m, i) => `${itemsById[m]?.name ?? m} x${fi.requirements.qty[i] ?? 1}`)
                  .join(', ');
                return (
                  <View key={fi.item} style={styles.rowCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        {meta?.name ?? fi.item} {meta?.level ? `(Lv.${meta.level})` : ''}
                      </Text>
                      <Text style={styles.rowSub}>Req: {reqText}</Text>
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
                  </View>
                );
              })}
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
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badgeCount: { color: '#FACC15', fontSize: 11, fontWeight: '800' },
  claimBtn: { backgroundColor: '#16A34A', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6 },
  disabledBtn: { opacity: 0.45 },
  claimText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  banner: {
    backgroundColor: '#1E293B', borderColor: '#F59E0B', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6,
  },
  bannerText: { color: '#FDE68A', fontSize: 11, fontWeight: '700' },
  body: { flex: 1, flexDirection: 'row', gap: 10 },
  previewCard: {
    width: 230, backgroundColor: '#0F172A', borderRadius: 10,
    borderWidth: 1, borderColor: '#1E293B', padding: 8,
  },
  previewTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  stageBox: { height: 155, backgroundColor: '#111827', borderRadius: 8, overflow: 'hidden' },
  previewDesc: { color: '#CBD5E1', fontSize: 10, marginTop: 6 },
  listPane: { flex: 1, backgroundColor: '#0F172A', borderRadius: 10, borderWidth: 1, borderColor: '#1E293B', padding: 8 },
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  tabBtn: { backgroundColor: '#1E293B', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  tabActive: { backgroundColor: '#DC2626' },
  tabText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  scrollList: { gap: 6, paddingBottom: 14 },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#111827',
    borderRadius: 8, borderWidth: 1, borderColor: '#1E293B', padding: 8, gap: 8,
  },
  rowSelected: { borderColor: '#F59E0B' },
  rowTitle: { color: '#F8FAFC', fontSize: 12, fontWeight: '800' },
  rowSub: { color: '#94A3B8', fontSize: 10, marginTop: 2 },
  huntBtn: { backgroundColor: '#DC2626', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  huntBtnText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
});
