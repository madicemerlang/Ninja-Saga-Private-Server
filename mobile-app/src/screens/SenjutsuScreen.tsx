import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MobileApiClient } from '../api/client';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
import { useAuthStore } from '../store/useAuthStore';

interface RawSenjutsuEntry {
  id: string;
  type: 'toad' | 'snake' | 'other' | string;
  name: string;
  description: string;
  damage?: number;
  sp_cost?: number;
  cooldown?: number;
  target?: string;
}

interface GroupedSenjutsuSkill {
  baseId: string;
  type: string;
  name: string;
  levels: Record<number, RawSenjutsuEntry>;
  maxLevel: number;
}

export function SenjutsuScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<GroupedSenjutsuSkill[]>([]);
  const [ownedLevels, setOwnedLevels] = useState<Record<string, number>>({});
  const [equippedIds, setEquippedIds] = useState<string[]>([]);
  const [ssBalance, setSsBalance] = useState(0);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const loadData = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const [rpcRes, rawJson] = await Promise.all([
        api.rpc<{
          status?: number;
          data?: Array<{ id: string; level: number; type?: string }>;
          ss?: number;
        }>('SenjutsuService', 'getSenjutsuSkills', [profile.charId, sessionKey], {
          sessionKey,
          charId: profile.charId,
        }),
        fetch(`${serverUrl.replace(/\/$/, '')}/game_data/senjutsu.json`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ]);

      const ownedMap: Record<string, number> = {};
      for (const s of rpcRes.data?.data ?? []) {
        ownedMap[s.id] = Number(s.level ?? 1);
      }
      setOwnedLevels(ownedMap);
      setSsBalance(Number(rpcRes.data?.ss ?? profile.ss ?? 0));

      const eq = String(profile.senjutsuSkills ?? '')
        .split(',')
        .map((x) => x.split(':')[0].trim())
        .filter(Boolean);
      setEquippedIds(eq);

      // Group senjutsu.json entries by baseId (e.g. skill_3001)
      const byBase = new Map<string, GroupedSenjutsuSkill>();
      if (Array.isArray(rawJson)) {
        for (const entry of rawJson as RawSenjutsuEntry[]) {
          if (!entry?.id) continue;
          const [baseId, lvStr] = String(entry.id).split(':');
          const lv = Math.max(1, Number(lvStr ?? 1));
          const existing = byBase.get(baseId);
          if (!existing) {
            byBase.set(baseId, {
              baseId,
              type: entry.type || 'other',
              name: entry.name || baseId,
              levels: { [lv]: entry },
              maxLevel: lv,
            });
          } else {
            existing.levels[lv] = entry;
            if (lv > existing.maxLevel) existing.maxLevel = lv;
          }
        }
      }
      setCatalog(Array.from(byBase.values()));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to load Senjutsu data.');
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey, serverUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!profile || !sessionKey) return null;

  const sageType = profile.senjutsuType; // 'toad' | 'snake' | null
  const visibleSkills = catalog.filter(
    (sk) => sk.type === 'other' || (sageType && sk.type === sageType)
  );
  const selectedSkill =
    visibleSkills.find((s) => s.baseId === selectedBaseId) ?? visibleSkills[0] ?? null;

  const handleDiscover = async (type: 'toad' | 'snake') => {
    setBusyId(`discover_${type}`);
    try {
      const res = await api.rpc<{ status?: number; result?: string; error?: string }>(
        'SenjutsuService',
        'discoverSenjutsu',
        [profile.charId, sessionKey, type],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setNotice(`Awakened ${type === 'toad' ? 'Toad' : 'Snake'} Sage Mode!`);
        await Promise.all([refreshProfile(), loadData()]);
      } else {
        setNotice(res.data?.result || res.data?.error || 'Could not awaken Sage Mode.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Discovery failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpgrade = async (baseId: string, isMax: boolean) => {
    setBusyId(`upg_${baseId}`);
    try {
      const res = await api.rpc<{ status?: number; result?: string; error?: string; ss?: number }>(
        'SenjutsuService',
        'upgradeSkill',
        [profile.charId, sessionKey, baseId, isMax],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setNotice(res.data?.result || 'Senjutsu skill upgraded!');
        await Promise.all([loadData(), refreshProfile()]);
      } else {
        setNotice(res.data?.result || res.data?.error || 'Upgrade failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Upgrade failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleEquip = async (baseId: string) => {
    if (!ownedLevels[baseId]) {
      setNotice('Learn this Senjutsu skill first.');
      return;
    }
    const next = equippedIds.includes(baseId)
      ? equippedIds.filter((id) => id !== baseId)
      : [...equippedIds, baseId].slice(0, 8);
    setBusyId(`eq_${baseId}`);
    try {
      const res = await api.rpc<{ status?: number; result?: string; error?: string }>(
        'SenjutsuService',
        'equipSkill',
        [profile.charId, sessionKey, next],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setEquippedIds(next);
        setNotice(equippedIds.includes(baseId) ? 'Senjutsu unequipped.' : 'Senjutsu equipped!');
        await refreshProfile();
      } else {
        setNotice(res.data?.result || res.data?.error || 'Equip failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Equip failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <NinjaScrollWindow
      title="Senjutsu — Sage Mode"
      bgSource={BUILDING_BGS.talentHall}
      onClose={() => navigate('hub')}
      rightContent={
        <View style={styles.ssPill}>
          <Text style={styles.ssTxt}>
            {sageType ? (sageType === 'toad' ? '🐸 Toad Sage' : '🐍 Snake Sage') : 'Unawakened'} •
            SS: {ssBalance.toLocaleString()}
          </Text>
        </View>
      }
    >
      <View style={styles.container}>
        <NinjaToast message={notice} top={6} />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
          </View>
        ) : !sageType ? (
          /* DISCOVERY VIEW */
          <View style={styles.discoverWrap}>
            <Text style={styles.discoverHeader}>Awaken Sage Mode (Requires Level 80 • 2,000,000 Gold)</Text>
            <View style={styles.discoverRow}>
              <View style={[styles.sageCard, { borderColor: '#EA580C' }]}>
                <Text style={styles.sageIcon}>🐸</Text>
                <Text style={styles.sageTitle}>Toad Sage Mode</Text>
                <Text style={styles.sageSub}>Mount Myoboku Path</Text>
                <Text style={styles.sageDesc}>
                  • +Max HP &amp; All Attack Damage{'\n'}
                  • Toad Oil Slow &amp; Fire Curse Burn{'\n'}
                  • Protective Shield of Toad &amp; SP Drain Bomb
                </Text>
                <Pressable
                  style={[styles.awakenBtn, { backgroundColor: '#EA580C' }]}
                  disabled={busyId !== null}
                  onPress={() => handleDiscover('toad')}
                >
                  <Text style={styles.awakenBtnTxt}>
                    {busyId === 'discover_toad' ? 'Awakening...' : 'Learn Toad Sage (2M Gold)'}
                  </Text>
                </Pressable>
              </View>

              <View style={[styles.sageCard, { borderColor: '#7C3AED' }]}>
                <Text style={styles.sageIcon}>🐍</Text>
                <Text style={styles.sageTitle}>Snake Sage Mode</Text>
                <Text style={styles.sageSub}>Ryuchi Cave Path</Text>
                <Text style={styles.sageDesc}>
                  • Reduced CP Cost &amp; Faster Cooldowns{'\n'}
                  • Toxic Fangs Petrify &amp; Poison{'\n'}
                  • Serpent Debuffs &amp; Critical Burst Arts
                </Text>
                <Pressable
                  style={[styles.awakenBtn, { backgroundColor: '#7C3AED' }]}
                  disabled={busyId !== null}
                  onPress={() => handleDiscover('snake')}
                >
                  <Text style={styles.awakenBtnTxt}>
                    {busyId === 'discover_snake' ? 'Awakening...' : 'Learn Snake Sage (2M Gold)'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          /* LEARNED SAGE SKILLS VIEW */
          <View style={styles.splitRow}>
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.leftCol} contentContainerStyle={styles.skillList}>
              {visibleSkills.map((sk) => {
                const lv = ownedLevels[sk.baseId] ?? 0;
                const isEq = equippedIds.includes(sk.baseId);
                const active = selectedSkill?.baseId === sk.baseId;
                return (
                  <Pressable
                    key={sk.baseId}
                    style={[styles.skillRow, active && styles.skillRowActive]}
                    onPress={() => setSelectedBaseId(sk.baseId)}
                  >
                    <View style={styles.skillBadge}>
                      <Text style={styles.skillBadgeTxt}>
                        {sk.type === 'toad' ? '🐸' : sk.type === 'snake' ? '🐍' : '☯️'}
                      </Text>
                    </View>
                    <View style={styles.skillMeta}>
                      <Text style={styles.skillName} numberOfLines={1}>
                        {sk.name}
                      </Text>
                      <Text style={styles.skillLv}>
                        Lv.{lv} / {sk.maxLevel} {isEq ? '• EQUIPPED' : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.rightCol}>
              {selectedSkill ? (() => {
                const curLv = ownedLevels[selectedSkill.baseId] ?? 0;
                const displayLv = Math.max(1, curLv);
                const detail = selectedSkill.levels[displayLv] ?? Object.values(selectedSkill.levels)[0];
                const isEq = equippedIds.includes(selectedSkill.baseId);
                const maxed = curLv >= selectedSkill.maxLevel;
                return (
                  <View style={styles.detailCard}>
                    <Text style={styles.detailName}>{selectedSkill.name}</Text>
                    <View style={styles.statChips}>
                      <Text style={styles.chip}>Level: {curLv}/{selectedSkill.maxLevel}</Text>
                      <Text style={styles.chip}>Damage: {detail?.damage ?? 0}</Text>
                      <Text style={styles.chip}>SP Cost: {detail?.sp_cost ?? 0}</Text>
                      <Text style={styles.chip}>CD: {detail?.cooldown ?? 0}t</Text>
                    </View>
                    <Text style={styles.detailDesc}>{detail?.description || 'No description.'}</Text>

                    <View style={styles.actionRow}>
                      <Pressable
                        style={[styles.actionBtn, styles.btnGreen, (maxed || busyId !== null) && styles.btnDisabled]}
                        disabled={maxed || busyId !== null}
                        onPress={() => handleUpgrade(selectedSkill.baseId, false)}
                      >
                        <Text style={styles.actionBtnTxt}>
                          {maxed ? 'MAXED' : curLv === 0 ? 'Learn (Lv.1)' : 'Upgrade +1'}
                        </Text>
                      </Pressable>

                      {!maxed ? (
                        <Pressable
                          style={[styles.actionBtn, styles.btnOrange, busyId !== null && styles.btnDisabled]}
                          disabled={busyId !== null}
                          onPress={() => handleUpgrade(selectedSkill.baseId, true)}
                        >
                          <Text style={styles.actionBtnTxt}>Upgrade MAX</Text>
                        </Pressable>
                      ) : null}

                      <Pressable
                        style={[
                          styles.actionBtn,
                          isEq ? styles.btnRed : styles.btnBlue,
                          (curLv === 0 || busyId !== null) && styles.btnDisabled,
                        ]}
                        disabled={curLv === 0 || busyId !== null}
                        onPress={() => handleToggleEquip(selectedSkill.baseId)}
                      >
                        <Text style={styles.actionBtnTxt}>{isEq ? 'Unequip' : 'Equip'}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })() : null}
            </View>
          </View>
        )}
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 8 },
  ssPill: {
    backgroundColor: '#3E2008',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ssTxt: { color: '#FFE082', fontWeight: '800', fontSize: 12 },
  noticeBanner: {
    backgroundColor: '#3E2008',
    borderColor: NS_THEME.goldTrim,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  noticeTxt: { color: '#FFE082', fontWeight: '700', fontSize: 12, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  discoverWrap: { flex: 1, gap: 10 },
  discoverHeader: {
    color: NS_THEME.inkDark,
    fontWeight: '900',
    fontSize: 14,
    textAlign: 'center',
  },
  discoverRow: { flex: 1, flexDirection: 'row', gap: 12 },
  sageCard: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 2,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sageIcon: { fontSize: 38 },
  sageTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 16 },
  sageSub: { color: NS_THEME.inkSoft, fontWeight: '700', fontSize: 12 },
  sageDesc: { color: NS_THEME.inkMid, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  awakenBtn: {
    width: '100%',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  awakenBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  splitRow: { flex: 1, flexDirection: 'row', gap: 10 },
  leftCol: { flex: 1.05 },
  rightCol: { flex: 1.25 },
  skillList: { gap: 6, paddingBottom: 12 },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    padding: 8,
  },
  skillRowActive: {
    backgroundColor: NS_THEME.parchmentSelected,
    borderColor: '#D95B16',
  },
  skillBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#3E2008',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillBadgeTxt: { fontSize: 18 },
  skillMeta: { flex: 1 },
  skillName: { color: NS_THEME.inkDark, fontWeight: '800', fontSize: 12 },
  skillLv: { color: NS_THEME.inkSoft, fontWeight: '700', fontSize: 11 },
  detailCard: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 12,
    justifyContent: 'space-between',
  },
  detailName: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 16 },
  statChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: NS_THEME.inkDark,
    fontWeight: '800',
    fontSize: 11,
  },
  detailDesc: { color: NS_THEME.inkMid, fontSize: 13, lineHeight: 19, flex: 1, marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3E2008',
  },
  actionBtnTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  btnGreen: { backgroundColor: NS_THEME.btnGreen },
  btnOrange: { backgroundColor: NS_THEME.btnOrange },
  btnBlue: { backgroundColor: NS_THEME.btnBlue },
  btnRed: { backgroundColor: NS_THEME.btnRed },
  btnDisabled: { opacity: 0.45 },
});
