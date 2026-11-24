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
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
import { useAuthStore } from '../store/useAuthStore';

type SocialTab = 'mail' | 'friends' | 'leaderboard' | 'clan';
type FriendSub = 'list' | 'requests' | 'find';

interface MailEntry {
  mail_id: number;
  mail_title: string;
  mail_sender: string;
  mail_body: string;
  mail_rewards?: string[];
  mail_viewed: number;
  mail_claimed: number;
  mail_type?: number;
}

interface FriendEntry {
  id?: number;
  char_id?: number;
  friend_id?: number;
  name?: string;
  character_name?: string;
  level?: number;
  character_level?: number;
  favorite?: boolean;
}

function getFriendId(f: FriendEntry, fallbackIdx: number): number {
  return Number(f.char_id ?? f.friend_id ?? f.id ?? fallbackIdx);
}

interface LeaderEntry {
  char_id: number;
  name: string;
  level?: number;
  kill: number;
  rank: number;
}

interface ClanSummary {
  id: number;
  name: string;
  master_id: number;
  master_name: string;
  prestige: number;
  members: number;
  max_members: number;
  announcement: string;
}

interface ClanMemberRow {
  char_id: number;
  name: string;
  level: number;
  rank: number;
  role: string;
}

const RANK_LABEL: Record<number, string> = {
  1: 'Genin',
  3: 'Chunin',
  5: 'Jounin',
  7: 'Special Jounin',
  8: 'Ninja Tutor',
};

function normalizeFriendList(raw: unknown): FriendEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: FriendEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const ch = (r.char && typeof r.char === 'object' ? r.char : null) as Record<string, unknown> | null;
    const cid = Number(r.char_id ?? r.id ?? ch?.char_id ?? ch?.id ?? 0);
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    out.push({
      char_id: cid,
      id: cid,
      name: String(r.name ?? r.character_name ?? ch?.name ?? ch?.character_name ?? `Shinobi #${cid}`),
      level: Number(r.level ?? r.character_level ?? ch?.level ?? ch?.character_level ?? 1),
      favorite: Boolean(r.favorite ?? r.is_favorite),
    });
  }
  return out;
}

export function SocialHubScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [tab, setTab] = useState<SocialTab>('mail');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Mail
  const [mails, setMails] = useState<MailEntry[]>([]);
  const [selectedMail, setSelectedMail] = useState<MailEntry | null>(null);

  // Friends
  const [friendSub, setFriendSub] = useState<FriendSub>('list');
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [requests, setRequests] = useState<FriendEntry[]>([]);
  const [recs, setRecs] = useState<FriendEntry[]>([]);
  const [friendQuery, setFriendQuery] = useState('');
  const [hasSearchedFriend, setHasSearchedFriend] = useState(false);
  const [sentFriendIds, setSentFriendIds] = useState<Record<number, boolean>>({});

  // Leaderboard
  const [lbCat, setLbCat] = useState('level');
  const [lbCats, setLbCats] = useState<Array<[string, string]>>([
    ['level', 'Top Level'],
    ['rank', 'Top Rank'],
    ['gold', 'Top Gold'],
    ['christmas_2025', 'Event Battles'],
  ]);
  const [lbKillText, setLbKillText] = useState('Level');
  const [lbRows, setLbRows] = useState<LeaderEntry[]>([]);

  // Clan
  const [myClan, setMyClan] = useState<ClanSummary | null>(null);
  const [isClanMaster, setIsClanMaster] = useState(false);
  const [clanMembers, setClanMembers] = useState<ClanMemberRow[]>([]);
  const [clanList, setClanList] = useState<ClanSummary[]>([]);
  const [newClanName, setNewClanName] = useState('');
  const [clanSearch, setClanSearch] = useState('');

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  const refreshProfile = useCallback(async () => {
    if (!profile || !sessionKey) return;
    try {
      const fresh = await api.getCharacter(profile.charId, sessionKey);
      setProfileFromRaw(profile.charId, fresh);
    } catch {
      // ignore
    }
  }, [api, profile, sessionKey, setProfileFromRaw]);

  const loadMail = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const res = await api.rpc<{ status?: number; mails?: MailEntry[] }>(
        'MailService',
        'executeService',
        ['getMails', [profile.charId, sessionKey]],
        { sessionKey, charId: profile.charId }
      );
      const list = Array.isArray(res.data?.mails) ? res.data.mails : [];
      setMails(list);
      setSelectedMail((prev) =>
        prev ? list.find((m: MailEntry) => m.mail_id === prev.mail_id) ?? list[0] ?? null : list[0] ?? null
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to load mail.');
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey]);

  const loadFriends = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const [fRes, rRes] = await Promise.all([
        api.rpc<{ friends?: unknown[]; data?: unknown[] }>(
          'FriendService',
          'friends',
          [profile.charId, sessionKey, 1],
          { sessionKey, charId: profile.charId }
        ),
        api.rpc<{ invitations?: unknown[]; requests?: unknown[]; friends?: unknown[]; data?: unknown[] }>(
          'FriendService',
          'friendRequests',
          [profile.charId, sessionKey, 1],
          { sessionKey, charId: profile.charId }
        ),
      ]);
      setFriends(normalizeFriendList(fRes.data?.friends ?? fRes.data?.data));
      setRequests(
        normalizeFriendList(
          rRes.data?.invitations ?? rRes.data?.requests ?? rRes.data?.friends ?? rRes.data?.data
        )
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to load friends.');
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey]);

  const loadLeaderboard = useCallback(
    async (category: string) => {
      if (!profile || !sessionKey) return;
      setLoading(true);
      try {
        const res = await api.rpc<{
          categories?: Array<[string, string]>;
          kill_text?: string;
          data?: LeaderEntry[];
        }>('LeaderboardService', 'getData', [profile.charId, sessionKey, category], {
          sessionKey,
          charId: profile.charId,
        });
        if (Array.isArray(res.data?.categories) && res.data.categories.length > 0) {
          setLbCats(res.data.categories);
        }
        setLbKillText(res.data?.kill_text ?? 'Score');
        setLbRows(Array.isArray(res.data?.data) ? res.data.data : []);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'Failed to load leaderboard.');
      } finally {
        setLoading(false);
      }
    },
    [api, profile, sessionKey]
  );

  const loadClan = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const [myRes, allRes] = await Promise.all([
        api.rpc<{
          clan?: ClanSummary | null;
          is_master?: boolean;
          members?: ClanMemberRow[];
        }>('ClanService', 'getClanData', [profile.charId, sessionKey], {
          sessionKey,
          charId: profile.charId,
        }),
        api.rpc<{ clans?: ClanSummary[] }>(
          'ClanService',
          'getAllClans',
          [profile.charId, sessionKey],
          { sessionKey, charId: profile.charId }
        ),
      ]);
      setMyClan(myRes.data?.clan ?? null);
      setIsClanMaster(Boolean(myRes.data?.is_master));
      setClanMembers(Array.isArray(myRes.data?.members) ? myRes.data.members : []);
      setClanList(Array.isArray(allRes.data?.clans) ? allRes.data.clans : []);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to load clan.');
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey]);

  useEffect(() => {
    if (tab === 'mail') loadMail();
    else if (tab === 'friends') loadFriends();
    else if (tab === 'leaderboard') loadLeaderboard(lbCat);
    else if (tab === 'clan') loadClan();
  }, [tab, lbCat, loadMail, loadFriends, loadLeaderboard, loadClan]);

  if (!profile || !sessionKey) return null;

  // Mail Actions
  const mailAction = async (sub: string, args: unknown[], okMsg: string) => {
    setBusy(true);
    try {
      const res = await api.rpc<{ status?: number; result?: string; error?: string }>(
        'MailService',
        'executeService',
        [sub, [profile.charId, sessionKey, ...args]],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setNotice(res.data?.result || okMsg);
        await Promise.all([loadMail(), refreshProfile()]);
      } else {
        setNotice(res.data?.result || res.data?.error || 'Action failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Mail action failed.');
    } finally {
      setBusy(false);
    }
  };

  // Friend Actions
  const friendAction = async (method: string, extra: unknown[], okMsg: string) => {
    setBusy(true);
    try {
      const res = await api.rpc<{ status?: number; result?: string; error?: string }>(
        'FriendService',
        method,
        [profile.charId, sessionKey, ...extra],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setNotice(res.data?.result || okMsg);
        await loadFriends();
      } else {
        setNotice(res.data?.result || res.data?.error || 'Action failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Friend action failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleFriendSearch = async () => {
    if (!friendQuery.trim()) {
      setRecs([]);
      setHasSearchedFriend(false);
      return;
    }
    setBusy(true);
    setHasSearchedFriend(true);
    try {
      const res = await api.rpc<{ friends?: unknown[]; data?: unknown[] }>(
        'FriendService',
        'search',
        [profile.charId, sessionKey, friendQuery.trim()],
        { sessionKey, charId: profile.charId }
      );
      setRecs(normalizeFriendList(res.data?.friends ?? res.data?.data));
    } catch {
      setNotice('Search failed.');
    } finally {
      setBusy(false);
    }
  };

  // Clan Actions
  const clanAction = async (method: string, extra: unknown[], okMsg: string) => {
    setBusy(true);
    try {
      const res = await api.rpc<{ status?: number; result?: string; error?: string }>(
        'ClanService',
        method,
        [profile.charId, sessionKey, ...extra],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setNotice(res.data?.result || okMsg);
        setNewClanName('');
        await Promise.all([loadClan(), refreshProfile()]);
      } else {
        setNotice(res.data?.result || res.data?.error || 'Clan action failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Clan action failed.');
    } finally {
      setBusy(false);
    }
  };

  const filteredClans = clanSearch.trim()
    ? clanList.filter((c) => c.name.toLowerCase().includes(clanSearch.trim().toLowerCase()))
    : clanList;

  return (
    <NinjaScrollWindow
      title="Village Social — Mail • Friends • Rank • Clan"
      bgSource={BUILDING_BGS.missionRoom}
      onClose={() => navigate('hub')}
    >
      <View style={styles.container}>
        {/* Main 4 Tabs */}
        <View style={styles.tabRow}>
          {(
            [
              ['mail', '📬 Mail'],
              ['friends', '🤝 Friends'],
              ['leaderboard', '🏆 Leaderboard'],
              ['clan', '🏯 Clan'],
            ] as Array<[SocialTab, string]>
          ).map(([k, lbl]) => (
            <Pressable
              key={k}
              style={[styles.tabBtn, tab === k && styles.tabBtnActive]}
              onPress={() => setTab(k)}
            >
              <Text style={[styles.tabTxt, tab === k && styles.tabTxtActive]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>

        <NinjaToast message={notice} top={6} />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
          </View>
        ) : tab === 'mail' ? (
          /* MAIL TAB */
          <View style={styles.splitRow}>
            <View style={styles.leftCol}>
              <View style={styles.inlineBtns}>
                <Pressable
                  style={[styles.smallBtn, styles.btnGreen, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={() => mailAction('claimAllRewards', [], 'All rewards claimed!')}
                >
                  <Text style={styles.smallBtnTxt}>Claim All</Text>
                </Pressable>
                <Pressable
                  style={[styles.smallBtn, styles.btnRed, busy && styles.btnDisabled]}
                  disabled={busy}
                  onPress={() => mailAction('deleteAllMails', [], 'All mail deleted.')}
                >
                  <Text style={styles.smallBtnTxt}>Delete All</Text>
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listGap}>
                {mails.length === 0 ? (
                  <Text style={styles.emptyTxt}>Your inbox is empty.</Text>
                ) : (
                  mails.map((m) => (
                    <Pressable
                      key={m.mail_id}
                      style={[
                        styles.rowCard,
                        selectedMail?.mail_id === m.mail_id && styles.rowCardSelected,
                      ]}
                      onPress={() => {
                        setSelectedMail(m);
                        if (!m.mail_viewed) {
                          mailAction('openMail', [m.mail_id], '');
                        }
                      }}
                    >
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {!m.mail_viewed ? '🔵 ' : ''}
                        {m.mail_title}
                      </Text>
                      <Text style={styles.rowSub}>From: {m.mail_sender}</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </View>

            <View style={styles.rightCol}>
              {selectedMail ? (
                <View style={styles.detailBox}>
                  <Text style={styles.detailTitle}>{selectedMail.mail_title}</Text>
                  <Text style={styles.rowSub}>From: {selectedMail.mail_sender}</Text>
                  <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={{ flex: 1, marginVertical: 6 }}>
                    <Text style={styles.detailBody}>{selectedMail.mail_body || 'No message body.'}</Text>
                    {selectedMail.mail_rewards && selectedMail.mail_rewards.length > 0 ? (
                      <Text style={styles.attachTxt}>
                        Attachments: {selectedMail.mail_rewards.join(', ')}
                      </Text>
                    ) : null}
                  </ScrollView>
                  <View style={styles.inlineBtns}>
                    {selectedMail.mail_rewards &&
                    selectedMail.mail_rewards.length > 0 &&
                    !selectedMail.mail_claimed ? (
                      <Pressable
                        style={[styles.smallBtn, styles.btnGreen, busy && styles.btnDisabled]}
                        disabled={busy}
                        onPress={() =>
                          mailAction('claimRewards', [selectedMail.mail_id], 'Rewards claimed!')
                        }
                      >
                        <Text style={styles.smallBtnTxt}>Claim Rewards</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={[styles.smallBtn, styles.btnRed, busy && styles.btnDisabled]}
                      disabled={busy}
                      onPress={() => mailAction('deleteMail', [selectedMail.mail_id], 'Mail deleted.')}
                    >
                      <Text style={styles.smallBtnTxt}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.center}>
                  <Text style={styles.emptyTxt}>Select a mail to read.</Text>
                </View>
              )}
            </View>
          </View>
        ) : tab === 'friends' ? (
          /* FRIENDS TAB */
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.subTabRow}>
              <Pressable
                style={[styles.subBtn, friendSub === 'list' && styles.subBtnActive]}
                onPress={() => setFriendSub('list')}
              >
                <Text style={styles.subBtnTxt}>My Friends ({friends.length})</Text>
              </Pressable>
              <Pressable
                style={[styles.subBtn, friendSub === 'requests' && styles.subBtnActive]}
                onPress={() => setFriendSub('requests')}
              >
                <Text style={styles.subBtnTxt}>Requests ({requests.length})</Text>
              </Pressable>
              <Pressable
                style={[styles.subBtn, friendSub === 'find' && styles.subBtnActive]}
                onPress={() => setFriendSub('find')}
              >
                <Text style={styles.subBtnTxt}>Find Shinobi</Text>
              </Pressable>
            </View>

            {friendSub === 'find' ? (
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.input}
                  value={friendQuery}
                  onChangeText={setFriendQuery}
                  placeholder="Search ninja name or ID..."
                  placeholderTextColor="#7A4C24"
                />
                <Pressable style={[styles.smallBtn, styles.btnBlue]} onPress={handleFriendSearch}>
                  <Text style={styles.smallBtnTxt}>Search</Text>
                </Pressable>
              </View>
            ) : null}

            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listGap}>
              {friendSub === 'list' &&
                (friends.length === 0 ? (
                  <Text style={styles.emptyTxt}>No friends yet. Add shinobi in Find Shinobi!</Text>
                ) : (
                  friends.map((f, idx) => {
                    const fid = getFriendId(f, idx);
                    return (
                      <View key={`fr_${fid}_${idx}`} style={styles.rowCardH}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>
                            {f.favorite ? '★ ' : ''}
                            {f.name || f.character_name || `Ninja #${fid}`}
                          </Text>
                          <Text style={styles.rowSub}>
                            ID: {fid} • Lv.{f.level ?? f.character_level ?? 1}
                          </Text>
                        </View>
                        <Pressable
                          style={[styles.smallBtn, styles.btnOrange]}
                          disabled={busy}
                          onPress={() =>
                            friendAction(
                              f.favorite ? 'removeFavorite' : 'setFavorite',
                              [fid],
                              f.favorite ? 'Removed from favorites.' : 'Added to favorites!'
                            )
                          }
                        >
                          <Text style={styles.smallBtnTxt}>{f.favorite ? 'Unstar' : '★ Fav'}</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.smallBtn, styles.btnRed]}
                          disabled={busy}
                          onPress={() => friendAction('removeFriend', [fid], 'Friend removed.')}
                        >
                          <Text style={styles.smallBtnTxt}>Remove</Text>
                        </Pressable>
                      </View>
                    );
                  })
                ))}

              {friendSub === 'requests' &&
                (requests.length === 0 ? (
                  <Text style={styles.emptyTxt}>No pending friend requests.</Text>
                ) : (
                  requests.map((f, idx) => {
                    const fid = getFriendId(f, idx);
                    return (
                      <View key={`req_${fid}_${idx}`} style={styles.rowCardH}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>
                            {f.name || f.character_name || `Ninja #${fid}`}
                          </Text>
                          <Text style={styles.rowSub}>Lv.{f.level ?? f.character_level ?? 1}</Text>
                        </View>
                        <Pressable
                          style={[styles.smallBtn, styles.btnGreen]}
                          disabled={busy}
                          onPress={() => friendAction('acceptFriend', [fid], 'Friend accepted!')}
                        >
                          <Text style={styles.smallBtnTxt}>Accept</Text>
                        </Pressable>
                      </View>
                    );
                  })
                ))}

              {friendSub === 'find' &&
                (!hasSearchedFriend ? (
                  <Text style={styles.emptyTxt}>
                    Enter a ninja name or ID and tap Search to find shinobi.
                  </Text>
                ) : recs.length === 0 ? (
                  <Text style={styles.emptyTxt}>No shinobi found.</Text>
                ) : (
                  recs.map((f, idx) => {
                    const fid = getFriendId(f, idx);
                    const isAlreadyFriend = friends.some((fr, fi) => getFriendId(fr, fi) === fid);
                    const isSent = Boolean(sentFriendIds[fid]);
                    const isDisabled = busy || isAlreadyFriend || isSent;
                    return (
                      <View key={`find_${fid}_${idx}`} style={styles.rowCardH}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>
                            {f.name || f.character_name || `Ninja #${fid}`}
                          </Text>
                          <Text style={styles.rowSub}>
                            ID: {fid} • Lv.{f.level ?? f.character_level ?? 1}
                          </Text>
                        </View>
                        <Pressable
                          style={[
                            styles.smallBtn,
                            isAlreadyFriend || isSent ? styles.btnDisabled : styles.btnGreen,
                          ]}
                          disabled={isDisabled}
                          onPress={() => {
                            setSentFriendIds((prev) => ({ ...prev, [fid]: true }));
                            friendAction('addFriend', [fid], 'Friend request sent!');
                          }}
                        >
                          <Text style={styles.smallBtnTxt}>
                            {isAlreadyFriend ? '✓ Friends' : isSent ? '✓ Sent' : '+ Add Friend'}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })
                ))}
            </ScrollView>
          </View>
        ) : tab === 'leaderboard' ? (
          /* LEADERBOARD TAB */
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.subTabRow}>
              {lbCats.map(([key, label]) => (
                <Pressable
                  key={key}
                  style={[styles.subBtn, lbCat === key && styles.subBtnActive]}
                  onPress={() => setLbCat(key)}
                >
                  <Text style={styles.subBtnTxt}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listGap}>
              {lbRows.length === 0 ? (
                <Text style={styles.emptyTxt}>No rankings recorded yet for this category.</Text>
              ) : (
                lbRows.map((row, idx) => {
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                  return (
                    <View key={`${row.char_id}_${idx}`} style={styles.rowCardH}>
                      <Text style={styles.medalTxt}>{medal}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{row.name}</Text>
                        <Text style={styles.rowSub}>
                          {RANK_LABEL[row.rank] ?? `Rank ${row.rank}`} • Lv.{row.level ?? 1}
                        </Text>
                      </View>
                      <View style={styles.scorePill}>
                        <Text style={styles.scoreTxt}>
                          {lbKillText}: {Number(row.kill).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        ) : (
          /* CLAN TAB */
          <View style={{ flex: 1, gap: 8 }}>
            {myClan ? (
              <View style={styles.splitRow}>
                <View style={styles.detailBox}>
                  <Text style={styles.detailTitle}>🏯 {myClan.name}</Text>
                  <Text style={styles.rowSub}>
                    Master: {myClan.master_name} • Prestige: {myClan.prestige} • Members:{' '}
                    {myClan.members}/{myClan.max_members}
                  </Text>
                  <Text style={styles.detailBody}>
                    {myClan.announcement || 'Welcome to our Ninja Clan!'}
                  </Text>
                  <View style={styles.inlineBtns}>
                    {isClanMaster ? (
                      <Pressable
                        style={[styles.smallBtn, styles.btnRed, busy && styles.btnDisabled]}
                        disabled={busy}
                        onPress={() => clanAction('disbandClan', [], 'Clan disbanded.')}
                      >
                        <Text style={styles.smallBtnTxt}>Disband Clan</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[styles.smallBtn, styles.btnRed, busy && styles.btnDisabled]}
                        disabled={busy}
                        onPress={() => clanAction('leaveClan', [], 'Left clan.')}
                      >
                        <Text style={styles.smallBtnTxt}>Leave Clan</Text>
                      </Pressable>
                    )}
                  </View>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.rightCol} contentContainerStyle={styles.listGap}>
                  <Text style={styles.rowTitle}>Clan Members ({clanMembers.length})</Text>
                  {clanMembers.map((m) => (
                    <View key={m.char_id} style={styles.rowCardH}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>
                          {m.role === 'master' ? '👑 ' : ''}
                          {m.name}
                        </Text>
                        <Text style={styles.rowSub}>
                          Lv.{m.level} • {m.role.toUpperCase()}
                        </Text>
                      </View>
                      {isClanMaster && m.char_id !== profile.charId ? (
                        <Pressable
                          style={[styles.smallBtn, styles.btnRed]}
                          disabled={busy}
                          onPress={() => clanAction('kickMember', [m.char_id], 'Member kicked.')}
                        >
                          <Text style={styles.smallBtnTxt}>Kick</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <View style={styles.splitRow}>
                <View style={styles.leftCol}>
                  <View style={styles.searchRow}>
                    <TextInput
                      style={styles.input}
                      value={clanSearch}
                      onChangeText={setClanSearch}
                      placeholder="Filter clans..."
                      placeholderTextColor="#7A4C24"
                    />
                  </View>
                  <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listGap}>
                    {filteredClans.length === 0 ? (
                      <Text style={styles.emptyTxt}>No clans exist yet. Create the first one!</Text>
                    ) : (
                      filteredClans.map((c) => (
                        <View key={c.id} style={styles.rowCardH}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>🏯 {c.name}</Text>
                            <Text style={styles.rowSub}>
                              Master: {c.master_name} • {c.members}/{c.max_members} • Prestige:{' '}
                              {c.prestige}
                            </Text>
                          </View>
                          <Pressable
                            style={[styles.smallBtn, styles.btnGreen, busy && styles.btnDisabled]}
                            disabled={busy}
                            onPress={() => clanAction('joinClan', [c.id], `Joined ${c.name}!`)}
                          >
                            <Text style={styles.smallBtnTxt}>Join</Text>
                          </Pressable>
                        </View>
                      ))
                    )}
                  </ScrollView>
                </View>

                <View style={styles.detailBox}>
                  <Text style={styles.detailTitle}>Create a New Clan</Text>
                  <Text style={styles.rowSub}>Cost: 100,000 Gold • Max 20 Members</Text>
                  <TextInput
                    style={[styles.input, { marginVertical: 8 }]}
                    value={newClanName}
                    onChangeText={setNewClanName}
                    placeholder="Enter Clan Name (3-24 chars)"
                    placeholderTextColor="#7A4C24"
                  />
                  <Pressable
                    style={[styles.smallBtn, styles.btnOrange, busy && styles.btnDisabled]}
                    disabled={busy || newClanName.trim().length < 3}
                    onPress={() =>
                      clanAction('createClan', [newClanName.trim()], 'Clan created!')
                    }
                  >
                    <Text style={styles.smallBtnTxt}>Create Clan (100,000 Gold)</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 8 },
  tabRow: { flexDirection: 'row', gap: 6 },
  tabBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: NS_THEME.tabActive, borderColor: '#FFE082' },
  tabTxt: { color: '#FFF4DC', fontWeight: '700', fontSize: 12 },
  tabTxtActive: { color: '#FFFFFF', fontWeight: '900' },
  noticeBanner: {
    backgroundColor: '#3E2008',
    borderColor: NS_THEME.goldTrim,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  noticeTxt: { color: '#FFE082', fontWeight: '700', fontSize: 12, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  splitRow: { flex: 1, flexDirection: 'row', gap: 10 },
  leftCol: { flex: 1, gap: 6 },
  rightCol: { flex: 1.2 },
  listGap: { gap: 6, paddingBottom: 12 },
  inlineBtns: { flexDirection: 'row', gap: 6 },
  subTabRow: { flexDirection: 'row', gap: 6 },
  subBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
  },
  subBtnActive: { backgroundColor: '#D95B16', borderColor: '#FFE082' },
  subBtnTxt: { color: NS_THEME.inkDark, fontWeight: '800', fontSize: 11 },
  searchRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: '#FFF7E0',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: NS_THEME.inkDark,
    fontSize: 12,
    fontWeight: '700',
  },
  rowCard: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    padding: 8,
  },
  rowCardSelected: { backgroundColor: NS_THEME.parchmentSelected, borderColor: '#D95B16' },
  rowCardH: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    padding: 8,
  },
  rowTitle: { color: NS_THEME.inkDark, fontWeight: '800', fontSize: 12 },
  rowSub: { color: NS_THEME.inkSoft, fontSize: 11 },
  emptyTxt: { color: NS_THEME.inkSoft, fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 12 },
  detailBox: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 12,
    justifyContent: 'space-between',
  },
  detailTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 15 },
  detailBody: { color: NS_THEME.inkMid, fontSize: 12, lineHeight: 18, marginTop: 6 },
  attachTxt: { color: '#2E8534', fontWeight: '800', fontSize: 12, marginTop: 8 },
  medalTxt: { width: 34, textAlign: 'center', fontWeight: '900', fontSize: 14, color: NS_THEME.inkDark },
  scorePill: {
    backgroundColor: '#3E2008',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  scoreTxt: { color: '#FFE082', fontWeight: '800', fontSize: 11 },
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#3E2008',
    alignItems: 'center',
  },
  smallBtnTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 11 },
  btnGreen: { backgroundColor: NS_THEME.btnGreen },
  btnOrange: { backgroundColor: NS_THEME.btnOrange },
  btnBlue: { backgroundColor: NS_THEME.btnBlue },
  btnRed: { backgroundColor: NS_THEME.btnRed },
  btnDisabled: { opacity: 0.45 },
});
