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
import { MobileApiClient } from '../api/client';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
import { normalizeBaseUrl } from '../config/env';
import { useAuthStore, type RecruitedMember } from '../store/useAuthStore';

type RecruitTab = 'npc' | 'friend';

interface NpcDef {
  id: string;
  name: string;
  level: number;
  hp: number;
  cp: number;
  agility: number;
  description?: string;
}

interface RecruitableFriend {
  id?: number;
  char_id?: number;
  friend_id?: number;
  name?: string;
  character_name?: string;
  level?: number;
  character_level?: number;
}

export function RecruitScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);
  const recruitedTeam = useAuthStore((s) => s.recruitedTeam);
  const recruitMember = useAuthStore((s) => s.recruitMember);
  const dismissMember = useAuthStore((s) => s.dismissMember);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [tab, setTab] = useState<RecruitTab>('npc');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [npcs, setNpcs] = useState<NpcDef[]>([]);
  const [friends, setFriends] = useState<RecruitedMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  const loadAll = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const clean = normalizeBaseUrl(serverUrl);
      const [npcRaw, friendRes] = await Promise.all([
        fetch(`${clean}/game_data/npc.json`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        api
          .rpc<{ friends?: unknown[]; data?: unknown[] }>(
            'FriendService',
            'friends',
            [profile.charId, sessionKey, 1],
            { sessionKey, charId: profile.charId }
          )
          .catch(() => ({ data: { friends: [] as unknown[], data: [] as unknown[] } })),
      ]);

      const seenNpc = new Set<string>();
      const npcList: NpcDef[] = (Array.isArray(npcRaw) ? npcRaw : [])
        .filter((n: Record<string, unknown>) => {
          const nid = String(n?.id ?? '').trim();
          if (!nid || !n?.name || seenNpc.has(nid)) return false;
          seenNpc.add(nid);
          return true;
        })
        .map((n: Record<string, unknown>) => ({
          id: String(n.id),
          name: String(n.name),
          level: Number(n.level ?? 1),
          hp: Number(n.hp ?? 500),
          cp: Number(n.cp ?? 500),
          agility: Number(n.agility ?? 20),
          description: String(n.description ?? 'Skilled allied shinobi ready to join your squad.'),
        }))
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
      setNpcs(npcList);

      const rawFriends = Array.isArray(friendRes.data?.friends)
        ? friendRes.data.friends
        : Array.isArray(friendRes.data?.data)
        ? friendRes.data.data
        : [];
      const seenFriend = new Set<number>();
      const mappedFriends: RecruitedMember[] = [];
      for (const item of rawFriends) {
        if (!item || typeof item !== 'object') continue;
        const f = item as Record<string, unknown>;
        const ch = (f.char && typeof f.char === 'object' ? f.char : null) as Record<string, unknown> | null;
        const sets = (f.sets && typeof f.sets === 'object' ? f.sets : null) as Record<string, unknown> | null;
        const fid = Number(f.char_id ?? f.friend_id ?? f.id ?? ch?.char_id ?? ch?.id ?? 0);
        if (!fid || seenFriend.has(fid)) continue;
        seenFriend.add(fid);
        const lv = Math.max(1, Number(f.level ?? f.character_level ?? ch?.level ?? ch?.character_level ?? 1));
        const rawSk = String(sets?.skills ?? f.skills ?? 'skill_01');
        const eqSkills = rawSk
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 6);
        mappedFriends.push({
          id: `friend_${fid}`,
          name: String(f.name ?? f.character_name ?? ch?.name ?? ch?.character_name ?? `Ninja #${fid}`),
          level: lv,
          hp: 100 + lv * 45,
          cp: 100 + lv * 40,
          agility: 10 + lv * 2,
          kind: 'friend',
          equippedSkills: eqSkills.length > 0 ? eqSkills : ['skill_01'],
        });
      }
      setFriends(mappedFriends);
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey, serverUrl]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const list: RecruitedMember[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source: RecruitedMember[] =
      tab === 'npc'
        ? npcs.map((n) => ({
            id: n.id,
            name: n.name,
            level: n.level,
            hp: n.hp,
            cp: n.cp,
            agility: n.agility,
            kind: 'npc',
          }))
        : friends;

    return source.filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [tab, npcs, friends, search]);

  const selected = useMemo(
    () => list.find((m) => m.id === selectedId) ?? list[0] ?? null,
    [list, selectedId]
  );

  const selectedNpcMeta = useMemo(
    () => (selected?.kind === 'npc' ? npcs.find((n) => n.id === selected.id) : undefined),
    [selected, npcs]
  );

  const isInTeam = selected ? recruitedTeam.some((m) => m.id === selected.id) : false;

  const handleToggleRecruit = (member: RecruitedMember) => {
    playClickSfx(serverUrl);
    if (recruitedTeam.some((m) => m.id === member.id)) {
      dismissMember(member.id);
      setNotice(`Removed ${member.name} from your team.`);
      return;
    }
    if (recruitedTeam.length >= 2) {
      setNotice('Team is full (2/2)! Dismiss a teammate first.');
      return;
    }
    const ok = recruitMember(member);
    if (ok) {
      setNotice(`Recruited ${member.name} to your team!`);
    }
  };

  return (
    <NinjaScrollWindow
      title="Recruit Shinobi Team"
      bgSource={BUILDING_BGS.missionRoom}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <View style={styles.teamPill}>
          <Text style={styles.teamPillTxt}>👥 Team: {recruitedTeam.length} / 2</Text>
        </View>
      }
    >
      <NinjaToast message={notice} />

      <View style={styles.container}>
        {/* Active Team Bar (0/2, 1/2, 2/2) */}
        <View style={styles.teamBar}>
          <Text style={styles.teamBarLabel}>ACTIVE SQUAD ({recruitedTeam.length}/2)</Text>
          <View style={styles.teamSlotsRow}>
            {[0, 1].map((idx) => {
              const member = recruitedTeam[idx];
              return (
                <View key={idx} style={[styles.teamSlot, member && styles.teamSlotFilled]}>
                  {member ? (
                    <>
                      <Text style={styles.teamSlotName} numberOfLines={1}>
                        {member.kind === 'npc' ? '🥷' : '🤝'} {member.name} (Lv.{member.level})
                      </Text>
                      <Pressable
                        style={styles.dismissMini}
                        onPress={() => {
                          playClickSfx(serverUrl);
                          dismissMember(member.id);
                          setNotice(`Removed ${member.name} from team.`);
                        }}
                      >
                        <Text style={styles.dismissMiniTxt}>✕</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Text style={styles.teamSlotEmpty}>Slot {idx + 1}: Empty</Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* Tabs + Search */}
        <View style={styles.topBarRow}>
          <View style={styles.tabRow}>
            <Pressable
              style={[styles.tabBtn, tab === 'npc' && styles.tabBtnActive]}
              onPress={() => {
                playClickSfx(serverUrl);
                setTab('npc');
                setSearch('');
              }}
            >
              <Text style={[styles.tabTxt, tab === 'npc' && styles.tabTxtActive]}>
                🥷 Village NPCs ({npcs.length})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tabBtn, tab === 'friend' && styles.tabBtnActive]}
              onPress={() => {
                playClickSfx(serverUrl);
                setTab('friend');
                setSearch('');
              }}
            >
              <Text style={[styles.tabTxt, tab === 'friend' && styles.tabTxtActive]}>
                🤝 Friends ({friends.length})
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search ally..."
            placeholderTextColor="#7A4C24"
          />
        </View>

        {/* Encyclopedia Split View */}
        <View style={styles.splitBody}>
          <View style={styles.leftCol}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listWrap}>
                {list.length === 0 ? (
                  <Text style={styles.emptyTxt}>
                    {tab === 'friend'
                      ? 'No recruitable friends yet. Add friends in Social!'
                      : 'No NPCs match your search.'}
                  </Text>
                ) : (
                  list.map((m, idx) => {
                    const active = selected?.id === m.id;
                    const recruited = recruitedTeam.some((t) => t.id === m.id);
                    return (
                      <Pressable
                        key={`${m.kind}_${m.id}_${idx}`}
                        style={[styles.tile, active && styles.tileActive]}
                        onPress={() => {
                          playClickSfx(serverUrl);
                          setSelectedId(m.id);
                        }}
                      >
                        <View style={styles.avatarBox}>
                          <Text style={styles.avatarIcon}>{m.kind === 'npc' ? '🥷' : '🤝'}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.tileName} numberOfLines={1}>
                            {m.name}
                          </Text>
                          <Text style={styles.tileSub} numberOfLines={1}>
                            Lv.{m.level} • HP {m.hp.toLocaleString()} • AGI {m.agility}
                            {recruited ? ' • ★ IN TEAM' : ''}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            )}
          </View>

          <View style={styles.rightCol}>
            {selected ? (
              <View style={styles.detailCard}>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
                  <View style={styles.detailHeader}>
                    <View style={styles.detailAvatarBig}>
                      <Text style={{ fontSize: 26 }}>{selected.kind === 'npc' ? '🥷' : '🤝'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailTitle}>{selected.name}</Text>
                      <View
                        style={[
                          styles.typeBadge,
                          { backgroundColor: selected.kind === 'npc' ? '#B45309' : '#1D4ED8' },
                        ]}
                      >
                        <Text style={styles.typeBadgeTxt}>
                          {selected.kind === 'npc' ? 'Village NPC' : 'Friend Ally'} • Lv.
                          {selected.level}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.statChips}>
                    <Text style={styles.statChip}>❤️ HP: {selected.hp.toLocaleString()}</Text>
                    <Text style={styles.statChip}>💧 CP: {selected.cp.toLocaleString()}</Text>
                    <Text style={styles.statChip}>⚡ AGI: {selected.agility}</Text>
                  </View>

                  <View style={styles.descBox}>
                    <Text style={styles.descHeading}>Shinobi Profile</Text>
                    <Text style={styles.descBody}>
                      {selectedNpcMeta?.description ||
                        'Trusted allied shinobi who fights alongside you in missions and boss hunts.'}
                    </Text>
                  </View>
                </ScrollView>

                <Pressable
                  style={[
                    styles.actionBtn,
                    isInTeam ? styles.btnRed : styles.btnGreen,
                    !isInTeam && recruitedTeam.length >= 2 && styles.btnDisabled,
                  ]}
                  onPress={() => handleToggleRecruit(selected)}
                >
                  <Text style={styles.actionBtnTxt}>
                    {isInTeam
                      ? 'Dismiss from Team'
                      : recruitedTeam.length >= 2
                      ? 'Team Full (2/2)'
                      : '+ Recruit to Team'}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.center}>
                <Text style={styles.emptyTxt}>Select a shinobi to recruit.</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  teamPill: {
    backgroundColor: '#3E2008',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  teamPillTxt: { color: '#FFE082', fontWeight: '900', fontSize: 11.5 },
  container: { flex: 1, gap: 6 },
  teamBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  teamBarLabel: { color: NS_THEME.inkMid, fontWeight: '900', fontSize: 9.5 },
  teamSlotsRow: { flex: 1, flexDirection: 'row', gap: 6 },
  teamSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  teamSlotFilled: { backgroundColor: '#DCFCE7', borderColor: '#15803D' },
  teamSlotName: { flex: 1, color: NS_THEME.inkDark, fontWeight: '900', fontSize: 11 },
  teamSlotEmpty: { color: NS_THEME.inkSoft, fontWeight: '700', fontSize: 10.5, fontStyle: 'italic' },
  dismissMini: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: NS_THEME.btnRed,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  dismissMiniTxt: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '900' },
  topBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabRow: { flex: 1, flexDirection: 'row', gap: 6 },
  tabBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: NS_THEME.tabActive, borderColor: '#FFE082' },
  tabTxt: { color: '#FFF4DC', fontWeight: '800', fontSize: 11.5 },
  tabTxtActive: { color: '#FFFFFF', fontWeight: '900' },
  searchInput: {
    width: 150,
    backgroundColor: '#FFF7E0',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    color: NS_THEME.inkDark,
    fontSize: 11.5,
    fontWeight: '700',
  },
  splitBody: { flex: 1, flexDirection: 'row', gap: 10 },
  leftCol: { flex: 1.1 },
  rightCol: { flex: 1.15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listWrap: { gap: 5, paddingBottom: 10 },
  emptyTxt: { color: NS_THEME.inkSoft, fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 14 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    padding: 6,
  },
  tileActive: { backgroundColor: NS_THEME.parchmentSelected, borderColor: '#D95B16', borderWidth: 2 },
  avatarBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#231309',
    borderWidth: 1.5,
    borderColor: '#D9A438',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcon: { fontSize: 18 },
  tileName: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 12 },
  tileSub: { color: NS_THEME.inkSoft, fontWeight: '700', fontSize: 9.5, marginTop: 1 },
  detailCard: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 11,
    padding: 11,
    justifyContent: 'space-between',
    gap: 8,
  },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailAvatarBig: {
    width: 52,
    height: 52,
    borderRadius: 11,
    backgroundColor: '#231309',
    borderWidth: 2,
    borderColor: '#FACC15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 15 },
  typeBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },
  typeBadgeTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 10 },
  statChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  statChip: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    color: NS_THEME.inkDark,
    fontWeight: '800',
    fontSize: 10.5,
  },
  descBox: {
    backgroundColor: '#FFF7E0',
    borderWidth: 1.25,
    borderColor: '#D9A438',
    borderRadius: 8,
    padding: 9,
    gap: 3,
  },
  descHeading: { color: '#92400E', fontWeight: '900', fontSize: 10.5 },
  descBody: { color: NS_THEME.inkDark, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  actionBtn: {
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#3E2008',
    alignItems: 'center',
  },
  actionBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 12.5 },
  btnGreen: { backgroundColor: NS_THEME.btnGreen },
  btnRed: { backgroundColor: NS_THEME.btnRed },
  btnDisabled: { opacity: 0.45 },
});
