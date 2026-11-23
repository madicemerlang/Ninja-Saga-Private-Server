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
import { playClickSfx } from '../audio/audioManager';
import { MobileApiClient } from '../api/client';
import { loadGameData, type MissionDef } from '../api/gameData';
import { useAuthStore } from '../store/useAuthStore';

export function MissionScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setActiveBattle = useAuthStore((s) => s.setActiveBattle);
  const navigate = useAuthStore((s) => s.navigate);

  const [missions, setMissions] = useState<MissionDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  useEffect(() => {
    loadGameData(serverUrl)
      .then((bundle) => {
        const sorted = [...bundle.missions].sort((a, b) => (a.level || 0) - (b.level || 0));
        setMissions(sorted.slice(0, 40));
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [serverUrl]);

  const handleStartMission = async (mission: MissionDef) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setStartingId(mission.id);
    setError(null);
    try {
      const battle = await api.battleStart(profile.charId, sessionKey, mission.id);
      setActiveBattle(battle);
      navigate('battle');
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setStartingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigate('hub')}>
          <Text style={styles.backText}>← Village Hub</Text>
        </Pressable>
        <Text style={styles.title}>
          Mission Board {profile ? `(Lv.${profile.level} • Gold ${profile.gold})` : ''}
        </Text>
        <View style={{ width: 90 }} />
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#F59E0B" size="large" />
          <Text style={styles.loadingText}>Loading mission.json...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {missions.map((m) => {
            const locked = (profile?.level ?? 1) < (m.level || 1);
            const busy = startingId === m.id;
            return (
              <View key={m.id} style={[styles.card, locked && styles.cardLocked]}>
                <View style={styles.cardTop}>
                  <Text style={styles.grade}>{(m.grade || 'C').toUpperCase()}</Text>
                  <Text style={styles.reqLvl}>Lv.{m.level}</Text>
                </View>
                <Text style={styles.mName} numberOfLines={1}>
                  {m.name}
                </Text>
                <Text style={styles.mDesc} numberOfLines={2}>
                  {m.description}
                </Text>
                <Text style={styles.rewards}>
                  +{m.rewards?.xp ?? 0} XP • +{m.rewards?.gold ?? 0} Gold
                </Text>
                <Pressable
                  style={[styles.fightBtn, locked && styles.fightBtnDisabled]}
                  disabled={locked || busy}
                  onPress={() => handleStartMission(m)}
                >
                  <Text style={styles.fightText}>
                    {busy ? 'Starting...' : locked ? `Requires Lv.${m.level}` : 'Fight →'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
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
    marginBottom: 10,
  },
  backBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  backText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  errorText: {
    color: '#F87171',
    fontSize: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#94A3B8',
    marginTop: 8,
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 16,
  },
  card: {
    width: '31.8%',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 10,
  },
  cardLocked: {
    opacity: 0.55,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  grade: {
    color: '#F59E0B',
    fontWeight: '900',
    fontSize: 12,
  },
  reqLvl: {
    color: '#38BDF8',
    fontWeight: '700',
    fontSize: 11,
  },
  mName: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
  mDesc: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 3,
    minHeight: 28,
  },
  rewards: {
    color: '#FACC15',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
  },
  fightBtn: {
    marginTop: 8,
    backgroundColor: '#EA580C',
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  fightBtnDisabled: {
    backgroundColor: '#334155',
  },
  fightText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
});
