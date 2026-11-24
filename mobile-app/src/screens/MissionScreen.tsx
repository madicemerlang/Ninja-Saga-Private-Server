import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { playClickSfx } from '../audio/audioManager';
import { MobileApiClient } from '../api/client';
import { loadGameData, type MissionDef } from '../api/gameData';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { useAuthStore } from '../store/useAuthStore';

const GRADE_TABS = ['C', 'B', 'A', 'S', 'DAILY', 'TP'] as const;

export function MissionScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setActiveBattle = useAuthStore((s) => s.setActiveBattle);
  const navigate = useAuthStore((s) => s.navigate);

  const [missions, setMissions] = useState<MissionDef[]>([]);
  const [gradeTab, setGradeTab] = useState<(typeof GRADE_TABS)[number]>('C');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  useEffect(() => {
    loadGameData(serverUrl)
      .then((bundle) => {
        const visibleMissions = bundle.missions
          .filter((m) => m.visible !== false && Boolean(m.grade))
          .sort((a, b) => (a.level || 0) - (b.level || 0));
        setMissions(visibleMissions);
        const firstC = visibleMissions.find((m) => (m.grade || '').toUpperCase() === 'C');
        if (firstC) setSelectedId(firstC.id);
        else if (visibleMissions.length > 0) setSelectedId(visibleMissions[0].id);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [serverUrl]);

  const filteredMissions = useMemo(() => {
    return missions.filter((m) => (m.grade || '').toUpperCase() === gradeTab);
  }, [missions, gradeTab]);

  const selectedMission = useMemo(
    () =>
      filteredMissions.find((m) => m.id === selectedId) ??
      filteredMissions[0] ??
      null,
    [filteredMissions, selectedId]
  );

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

  const selectedLocked = selectedMission
    ? (profile?.level ?? 1) < (selectedMission.level || 1)
    : false;
  const selectedBusy = selectedMission ? startingId === selectedMission.id : false;

  return (
    <NinjaScrollWindow
      title="Mission Room"
      bgSource={BUILDING_BGS.missionRoom}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      headerCenter={
        <View style={styles.gradeRow}>
          {GRADE_TABS.map((g) => (
            <Pressable
              key={g}
              style={[styles.gradeTab, gradeTab === g && styles.gradeTabActive]}
              onPress={() => {
                playClickSfx(serverUrl);
                setGradeTab(g);
              }}
            >
              <Text style={[styles.gradeTabTxt, gradeTab === g && styles.gradeTabTxtActive]}>
                {g === 'DAILY' ? 'Daily' : g === 'TP' ? 'TP' : `Grade ${g}`}
              </Text>
            </Pressable>
          ))}
        </View>
      }
    >
      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={NS_THEME.btnOrange} size="large" />
          <Text style={styles.loadingText}>Loading missions...</Text>
        </View>
      ) : (
        <View style={styles.split}>
          {/* Left: Authentic Ninja Saga Mission Scroll List */}
          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.listCol} contentContainerStyle={styles.listContent}>
            {filteredMissions.map((m) => {
              const locked = (profile?.level ?? 1) < (m.level || 1);
              const isSelected = selectedMission?.id === m.id;
              const badgeTxt =
                (m.grade || 'C').toUpperCase() === 'DAILY'
                  ? 'D'
                  : (m.grade || 'C').toUpperCase();
              return (
                <Pressable
                  key={m.id}
                  style={[
                    styles.missionRow,
                    isSelected && styles.missionRowSelected,
                    locked && styles.missionRowLocked,
                  ]}
                  onPress={() => {
                    playClickSfx(serverUrl);
                    setSelectedId(m.id);
                  }}
                >
                  <View style={styles.gradeSeal}>
                    <Text style={styles.gradeSealTxt}>{badgeTxt}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text style={styles.rowSub}>
                      Lv.{m.level} • +{m.rewards?.xp ?? 0} XP • +{m.rewards?.gold ?? 0} Gold
                      {(m.rewards?.tp ?? 0) > 0 ? ` • +${m.rewards?.tp} TP` : ''}
                    </Text>
                  </View>
                  {locked ? (
                    <Text style={styles.lockTag}>🔒 Lv.{m.level}</Text>
                  ) : (
                    <Text style={styles.arrowTag}>▶</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Right: Selected Mission Scroll Brief */}
          <View style={styles.detailCol}>
            {selectedMission ? (
              <>
                <View style={styles.detailHeader}>
                  <View style={styles.bigGradeSeal}>
                    <Text style={styles.bigGradeTxt}>
                      {(selectedMission.grade || 'C').toUpperCase() === 'DAILY'
                        ? 'D'
                        : (selectedMission.grade || 'C').toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle}>{selectedMission.name}</Text>
                    <Text style={styles.detailReq}>
                      Min. Level {selectedMission.level} • {selectedMission.enemies?.length ?? 1}{' '}
                      {(selectedMission.enemies?.length ?? 1) === 1 ? 'Enemy' : 'Enemies'}
                    </Text>
                  </View>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.descScroll}>
                  <Text style={styles.detailDesc}>
                    {selectedMission.description || 'Complete this shinobi mission to protect the village!'}
                  </Text>
                </ScrollView>

                <View style={styles.rewardBox}>
                  <Text style={styles.rewardHeading}>MISSION REWARDS</Text>
                  <View style={styles.rewardRow}>
                    <View style={styles.rewardChip}>
                      <Text style={styles.rewardChipTxt}>
                        ⭐ +{(selectedMission.rewards?.xp ?? 0).toLocaleString()} XP
                      </Text>
                    </View>
                    <View style={styles.rewardChip}>
                      <Text style={styles.rewardChipTxt}>
                        🪙 +{(selectedMission.rewards?.gold ?? 0).toLocaleString()} Gold
                      </Text>
                    </View>
                    {(selectedMission.rewards?.tp ?? 0) > 0 ? (
                      <View style={styles.rewardChip}>
                        <Text style={styles.rewardChipTxt}>
                          ✨ +{(selectedMission.rewards?.tp ?? 0).toLocaleString()} TP
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <Pressable
                  style={[
                    styles.fightBtn,
                    selectedLocked && styles.fightBtnDisabled,
                  ]}
                  disabled={selectedLocked || selectedBusy}
                  onPress={() => handleStartMission(selectedMission)}
                >
                  <Text style={styles.fightText}>
                    {selectedBusy
                      ? 'Starting Battle...'
                      : selectedLocked
                        ? `Requires Level ${selectedMission.level}`
                        : '⚔️ Start Mission'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.center}>
                <Text style={styles.loadingText}>No missions available in this category.</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  gradeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  gradeTab: {
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  gradeTabActive: {
    backgroundColor: NS_THEME.tabActive,
    borderColor: NS_THEME.woodBorderDark,
  },
  gradeTabTxt: {
    color: NS_THEME.inkDark,
    fontSize: 10,
    fontWeight: '900',
  },
  gradeTabTxtActive: {
    color: '#FFFFFF',
  },
  errorText: {
    color: '#991B1B',
    backgroundColor: '#FEE2E2',
    borderColor: '#DC2626',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: NS_THEME.inkMid,
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
  },
  split: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  listCol: {
    flex: 1.25,
  },
  listContent: {
    gap: 6,
    paddingBottom: 8,
  },
  missionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  missionRowSelected: {
    backgroundColor: NS_THEME.parchmentSelected,
    borderColor: NS_THEME.btnOrange,
    borderWidth: 2,
  },
  missionRowLocked: {
    opacity: 0.65,
  },
  gradeSeal: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#B45309',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeSealTxt: {
    color: '#FEF08A',
    fontSize: 11,
    fontWeight: '900',
  },
  rowName: {
    color: NS_THEME.inkDark,
    fontSize: 12,
    fontWeight: '900',
  },
  rowSub: {
    color: NS_THEME.inkSoft,
    fontSize: 9.5,
    fontWeight: '700',
    marginTop: 1,
  },
  lockTag: {
    color: '#991B1B',
    fontSize: 9.5,
    fontWeight: '900',
  },
  arrowTag: {
    color: NS_THEME.btnOrange,
    fontSize: 11,
    fontWeight: '900',
  },
  detailCol: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorder,
    padding: 10,
    justifyContent: 'space-between',
    gap: 8,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(110, 62, 22, 0.35)',
    paddingBottom: 8,
  },
  bigGradeSeal: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#C85A17',
    borderWidth: 2,
    borderColor: NS_THEME.woodBorderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigGradeTxt: {
    color: '#FEF08A',
    fontSize: 16,
    fontWeight: '900',
  },
  detailTitle: {
    color: NS_THEME.inkDark,
    fontSize: 14,
    fontWeight: '900',
  },
  detailReq: {
    color: NS_THEME.inkSoft,
    fontSize: 10.5,
    fontWeight: '800',
    marginTop: 2,
  },
  descScroll: {
    flex: 1,
  },
  detailDesc: {
    color: NS_THEME.inkMid,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  rewardBox: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 8,
    gap: 5,
  },
  rewardHeading: {
    color: NS_THEME.inkDark,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  rewardRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rewardChip: {
    flex: 1,
    backgroundColor: '#FFF5D6',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: NS_THEME.goldTrim,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  rewardChipTxt: {
    color: NS_THEME.inkDark,
    fontSize: 11,
    fontWeight: '900',
  },
  fightBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorderDark,
    paddingVertical: 9,
    alignItems: 'center',
  },
  fightBtnDisabled: {
    backgroundColor: NS_THEME.btnDisabled,
  },
  fightText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
