import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { playBgm, playClickSfx } from '../audio/audioManager';
import { buildAudioUrl, buildPlayerSkillSwfUrl, buildPlayerSwfUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

const ELEMENT_LABELS: Record<number, string> = {
  1: 'Wind',
  2: 'Fire',
  3: 'Lightning',
  4: 'Earth',
  5: 'Water',
};

const PREVIEW_MODES = [
  { key: 'standby', label: 'Idle' },
  { key: 'attack_01', label: 'Attack' },
  { key: 'charge', label: 'Charge' },
  { key: 'win', label: 'Victory' },
  { key: 'jutsu', label: 'Jutsu' },
] as const;

export function VillageHubScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);
  const logout = useAuthStore((s) => s.logout);

  const [previewMode, setPreviewMode] = useState<(typeof PREVIEW_MODES)[number]['key']>('standby');
  const previewSkill = profile?.equippedSkills[0] ?? 'skill_01';

  const equipTag = profile
    ? `${profile.hairStyle}_${profile.clothing}_${profile.weapon}_${profile.back}`
    : '';

  useEffect(() => {
    playBgm(buildAudioUrl(serverUrl, 'bgm.mp3'));
  }, [serverUrl]);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => {
      if (previewMode === 'jutsu') {
        const url = buildPlayerSkillSwfUrl(serverUrl, profile.charId, previewSkill, equipTag);
        stageRef.current?.loadSwf(url);
      } else {
        const url = buildPlayerSwfUrl(serverUrl, profile.charId, previewMode, equipTag);
        stageRef.current?.loadSwf(url);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [serverUrl, profile, previewMode, previewSkill, equipTag]);

  if (!profile) {
    return null;
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* Top HUD Bar */}
      <View style={styles.topBar}>
        <View style={styles.profileGroup}>
          <Text style={styles.charName}>{profile.name}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Lv.{profile.level}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#1D4ED8' }]}>
            <Text style={styles.badgeText}>{ELEMENT_LABELS[profile.element1] ?? 'Ninja'}</Text>
          </View>
        </View>

        <View style={styles.statsGroup}>
          <Text style={styles.statText}>Gold: {profile.gold.toLocaleString()}</Text>
          <Text style={styles.statText}>XP: {profile.xp.toLocaleString()}</Text>
          <Pressable
            style={styles.smallBtn}
            onPress={() => {
              playClickSfx(serverUrl);
              navigate('charSelect');
            }}
          >
            <Text style={styles.smallBtnText}>Switch Char</Text>
          </Pressable>
          <Pressable
            style={[styles.smallBtn, { backgroundColor: '#7F1D1D' }]}
            onPress={() => {
              playClickSfx(serverUrl);
              logout();
            }}
          >
            <Text style={styles.smallBtnText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {/* Center Split: Ruffle Player Preview + Village Menu */}
      <View style={styles.body}>
        <View style={styles.stageCard}>
          <Text style={styles.stageLabel}>
            {profile.name} • Set: {profile.clothing} • Weapon: {profile.weapon}
          </Text>
          <View style={styles.stageBox}>
            <RuffleStageView ref={stageRef} baseUrl={serverUrl} />
          </View>
          <View style={styles.animRow}>
            {PREVIEW_MODES.map((m) => (
              <Pressable
                key={m.key}
                style={[styles.animChip, previewMode === m.key && styles.animChipActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setPreviewMode(m.key);
                }}
              >
                <Text style={styles.animChipText}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuGrid}>
          <View style={styles.subRow}>
            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#EA580C' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('missions');
              }}
            >
              <Text style={styles.menuTitleSmall}>⚔️ Missions</Text>
              <Text style={styles.menuDesc}>Battle musuh, EXP & Gold</Text>
            </Pressable>

            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#0EA5E9' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('inventory');
              }}
            >
              <Text style={styles.menuTitleSmall}>
                🎒 Shop & Stats{profile.points.free > 0 ? ` (+${profile.points.free})` : ''}
              </Text>
              <Text style={styles.menuDesc}>Weapon, Set, Jutsu & AP</Text>
            </Pressable>
          </View>

          <View style={styles.subRow}>
            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#10B981' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('pet');
              }}
            >
              <Text style={styles.menuTitleSmall}>🐾 Pet House</Text>
              <Text style={styles.menuDesc}>142 Pet asli, Buy & Equip</Text>
            </Pressable>

            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#F59E0B' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('academy');
              }}
            >
              <Text style={styles.menuTitleSmall}>📜 Advance Academy</Text>
              <Text style={styles.menuDesc}>Upgrade Jutsu Tier 1-5</Text>
            </Pressable>
          </View>

          <View style={styles.subRow}>
            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#EF4444' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('hunting');
              }}
            >
              <Text style={styles.menuTitleSmall}>🏹 Hunting House</Text>
              <Text style={styles.menuDesc}>Boss Hunt & Kari Badges</Text>
            </Pressable>

            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#D97706' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('forge');
              }}
            >
              <Text style={styles.menuTitleSmall}>⚒️ Forge (Blacksmith)</Text>
              <Text style={styles.menuDesc}>Tempa senjata & material</Text>
            </Pressable>
          </View>

          <View style={styles.subRow}>
            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#8B5CF6' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('talent');
              }}
            >
              <Text style={styles.menuTitleSmall}>✨ Talent Hall</Text>
              <Text style={styles.menuDesc}>Extreme & Secret (TP: {profile.tp})</Text>
            </Pressable>

            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#DC2626' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('pvp');
              }}
            >
              <Text style={styles.menuTitleSmall}>🥊 Live PvP Arena</Text>
              <Text style={styles.menuDesc}>Realtime 1v1 (:3000)</Text>
            </Pressable>
          </View>

          <View style={styles.subRow}>
            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#22C55E' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('chat');
              }}
            >
              <Text style={styles.menuTitleSmall}>💬 World Chat</Text>
              <Text style={styles.menuDesc}>Global Chat (:3002)</Text>
            </Pressable>

            <Pressable
              style={[styles.menuCardHalf, { borderColor: '#64748B' }]}
              onPress={() => {
                playClickSfx(serverUrl);
                navigate('poc');
              }}
            >
              <Text style={styles.menuTitleSmall}>🗂️ All Game Assets</Text>
              <Text style={styles.menuDesc}>7.459 SWF asli (11 kategori)</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#070E1A',
    padding: 12,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  profileGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  charName: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  badge: {
    backgroundColor: '#EA580C',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  statsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statText: {
    color: '#FACC15',
    fontSize: 12,
    fontWeight: '700',
  },
  smallBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
  },
  smallBtnText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  stageCard: {
    flex: 1.3,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 10,
  },
  stageLabel: {
    color: '#94A3B8',
    fontSize: 11,
    marginBottom: 6,
  },
  stageBox: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 8,
    overflow: 'hidden',
  },
  animRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    justifyContent: 'center',
  },
  animChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  animChipActive: {
    backgroundColor: '#2563EB',
  },
  animChipText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  menuScroll: {
    flex: 1.15,
  },
  menuGrid: {
    gap: 7,
    paddingBottom: 8,
  },
  menuCard: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    justifyContent: 'center',
  },
  menuTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  menuTitleSmall: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
  },
  subRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  menuCardHalf: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 10,
    justifyContent: 'center',
  },
  menuDesc: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 3,
  },
});
