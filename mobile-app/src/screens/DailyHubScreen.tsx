import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MobileApiClient } from '../api/client';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
import { useAuthStore } from '../store/useAuthStore';

type DailyTab = 'rewards' | 'roulette';

interface AttendanceItem {
  id: string;
  price: number;
  item: string;
}

interface RouletteSlot {
  id: number;
  type: 'tokens' | 'gold' | 'xp';
  baseAmount: number;
  color: string;
  accent: string;
}

// Mirrors authentic `roulette_rewards` from GameConfig (1..10)
const ROULETTE_SLOTS: RouletteSlot[] = [
  { id: 1, type: 'tokens', baseAmount: 1, color: '#0369A1', accent: '#BAE6FD' },
  { id: 2, type: 'gold', baseAmount: 500, color: '#B45309', accent: '#FDE68A' },
  { id: 3, type: 'xp', baseAmount: 100, color: '#15803D', accent: '#BBF7D0' },
  { id: 4, type: 'tokens', baseAmount: 3, color: '#1D4ED8', accent: '#BFDBFE' },
  { id: 5, type: 'gold', baseAmount: 10000, color: '#C2410C', accent: '#FED7AA' },
  { id: 6, type: 'xp', baseAmount: 200, color: '#0F766E', accent: '#99F6E4' },
  { id: 7, type: 'tokens', baseAmount: 5, color: '#6D28D9', accent: '#DDD6FE' },
  { id: 8, type: 'gold', baseAmount: 2000, color: '#A16207', accent: '#FEF08A' },
  { id: 9, type: 'xp', baseAmount: 500, color: '#166534', accent: '#86EFAC' },
  { id: 10, type: 'tokens', baseAmount: 10, color: '#991B1B', accent: '#FECACA' },
];

const SLICE_DEG = 360 / ROULETTE_SLOTS.length; // 36 deg per wedge
const WHEEL_SIZE = 228;
const WHEEL_RADIUS = WHEEL_SIZE / 2;

function fmtSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(r).padStart(2, '0')}s`;
}

function formatShortVal(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(n);
}

function formatRewardLabel(raw: string): string {
  const [type, valStr] = raw.split('_');
  const val = Number(valStr ?? 0);
  if (type === 'tokens') return `💎 ${val.toLocaleString()} Tokens`;
  if (type === 'gold') return `🪙 ${val.toLocaleString()} Gold`;
  if (type === 'xp') return `⭐ ${val.toLocaleString()} XP`;
  return raw.replace('_', ' ').toUpperCase();
}

export function DailyHubScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const accountType = useAuthStore((s) => s.accountType);
  const navigate = useAuthStore((s) => s.navigate);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [tab, setTab] = useState<DailyTab>('rewards');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Daily rewards state
  const [tokensAvail, setTokensAvail] = useState(false);
  const [xpAvail, setXpAvail] = useState(false);
  const [scrollClaimed, setScrollClaimed] = useState(false);
  const [doubleXpTimer, setDoubleXpTimer] = useState(0);
  const [attCount, setAttCount] = useState(0);
  const [attClaimed, setAttClaimed] = useState<number[]>([]);
  const [attItems, setAttItems] = useState<AttendanceItem[]>([]);

  // Roulette state
  const [canSpin, setCanSpin] = useState(false);
  const [streakBonus, setStreakBonus] = useState(1);
  const [lastSpinReward, setLastSpinReward] = useState<string | null>(null);
  const [wonSlotId, setWonSlotId] = useState<number | null>(null);

  // Wheel rotation animation
  const spinAnim = useRef(new Animated.Value(0)).current;
  const currentDegRef = useRef(0);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const iv = setInterval(() => {
      setDoubleXpTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!profile || !sessionKey) return;
    try {
      const fresh = await api.getCharacter(profile.charId, sessionKey);
      setProfileFromRaw(profile.charId, fresh);
    } catch {
      // ignore
    }
  }, [api, profile, sessionKey, setProfileFromRaw]);

  const loadAll = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const [dailyRes, attRes, roulRes] = await Promise.all([
        api.rpc<{ status?: number; tokens?: boolean; xp?: boolean; scroll?: boolean; timer?: number }>(
          'DailyRewardService',
          'getDailyData',
          [profile.charId, sessionKey],
          { sessionKey, charId: profile.charId }
        ),
        api.rpc<{ status?: number; count?: number; rewards?: number[]; items?: AttendanceItem[] }>(
          'DailyRewardService',
          'getAttendances',
          [profile.charId, sessionKey],
          { sessionKey, charId: profile.charId }
        ),
        api.rpc<{ status?: number; can_spin?: number; bonus?: number }>(
          'DailyRouletteService',
          'getData',
          [profile.charId, sessionKey],
          { sessionKey, charId: profile.charId }
        ),
      ]);

      setTokensAvail(Boolean(dailyRes.data?.tokens));
      setXpAvail(Boolean(dailyRes.data?.xp));
      setScrollClaimed(Boolean(dailyRes.data?.scroll));
      setDoubleXpTimer(Number(dailyRes.data?.timer ?? 0));

      setAttCount(Number(attRes.data?.count ?? 0));
      setAttClaimed(Array.isArray(attRes.data?.rewards) ? attRes.data.rewards : []);
      setAttItems(Array.isArray(attRes.data?.items) ? attRes.data.items : []);

      setCanSpin(Number(roulRes.data?.can_spin ?? 0) === 1);
      setStreakBonus(Math.max(1, Number(roulRes.data?.bonus ?? 1)));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to load daily data.');
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (!profile || !sessionKey) return null;

  const callDaily = async (method: string, extraArgs: unknown[], okMsg: string) => {
    setBusy(true);
    try {
      const res = await api.rpc<{ status?: number; result?: string; error?: string; reward?: string }>(
        'DailyRewardService',
        method,
        [profile.charId, sessionKey, ...extraArgs],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setNotice(res.data?.result || (res.data?.reward ? `Claimed: ${res.data.reward}` : okMsg));
        await Promise.all([loadAll(), refreshProfile()]);
      } else {
        setNotice(res.data?.result || res.data?.error || 'Cannot claim right now.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Claim failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSpin = async () => {
    if (!canSpin || busy || spinning) return;
    playClickSfx(serverUrl);
    setBusy(true);
    setSpinning(true);
    setWonSlotId(null);
    setLastSpinReward(null);

    try {
      const res = await api.rpc<{
        status?: number;
        reward_string?: string;
        reward?: number | string;
        bonus?: number;
        result?: string;
        error?: string;
      }>('DailyRouletteService', 'spin', [profile.charId, sessionKey], {
        sessionKey,
        charId: profile.charId,
      });

      if (res.data?.status !== 1) {
        setSpinning(false);
        setBusy(false);
        setNotice(res.data?.result || res.data?.error || 'No spins remaining today.');
        return;
      }

      const winningId = Math.max(1, Math.min(10, Number(res.data?.reward ?? 1)));
      const slotIndex = winningId - 1; // 0..9
      const rewardRaw = res.data?.reward_string || 'gold_500';

      // Slot `i` sits at clockwise angle `i * SLICE_DEG` from 12 o'clock.
      // Rotating wheel clockwise by `(360 - i * SLICE_DEG)` brings slot `i` to 12 o'clock under the pointer!
      const desiredMod = (360 - slotIndex * SLICE_DEG) % 360;
      const currentMod = ((currentDegRef.current % 360) + 360) % 360;
      const deltaMod = (desiredMod - currentMod + 360) % 360;
      const totalRotations = 6 * 360; // 6 full dramatic spins like Ninja Sage
      const targetDeg = currentDegRef.current + totalRotations + deltaMod;

      Animated.timing(spinAnim, {
        toValue: targetDeg,
        duration: 4200,
        easing: Easing.bezier(0.12, 0.85, 0.22, 1),
        useNativeDriver: true,
      }).start(async ({ finished }) => {
        currentDegRef.current = targetDeg;
        setSpinning(false);
        setBusy(false);
        if (finished) {
          setWonSlotId(winningId);
          const niceLabel = formatRewardLabel(rewardRaw);
          setLastSpinReward(niceLabel);
          setNotice(`Roulette Won: ${niceLabel}!`);
          await Promise.all([loadAll(), refreshProfile()]);
        }
      });
    } catch (e) {
      setSpinning(false);
      setBusy(false);
      setNotice(e instanceof Error ? e.message : 'Spin failed.');
    }
  };

  const wheelRotate = spinAnim.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <NinjaScrollWindow
      title="Daily Rewards & Roulette"
      bgSource={BUILDING_BGS.ninjaShop}
      onClose={() => {
        if (!spinning) navigate('hub');
      }}
      rightContent={
        <View style={styles.pill}>
          <Text style={styles.pillTxt}>
            🪙 {profile.gold.toLocaleString()} • 💎 {profile.tokens.toLocaleString()}
          </Text>
        </View>
      }
    >
      <View style={styles.container}>
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tabBtn, tab === 'rewards' && styles.tabBtnActive]}
            onPress={() => !spinning && setTab('rewards')}
          >
            <Text style={[styles.tabTxt, tab === 'rewards' && styles.tabTxtActive]}>
              🎁 Daily Rewards &amp; Attendance
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, tab === 'roulette' && styles.tabBtnActive]}
            onPress={() => !spinning && setTab('roulette')}
          >
            <Text style={[styles.tabTxt, tab === 'roulette' && styles.tabTxtActive]}>
              🎡 Daily Roulette ({canSpin ? 'READY' : 'USED'})
            </Text>
          </Pressable>
        </View>

        <NinjaToast message={notice} top={6} />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
          </View>
        ) : tab === 'rewards' ? (
          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            <View style={styles.cardGrid}>
              <View style={styles.rewardCard}>
                <Text style={styles.cardIcon}>💎</Text>
                <Text style={styles.cardTitle}>Daily Tokens</Text>
                <Text style={styles.cardSub}>Claim free Tokens every day</Text>
                <Pressable
                  style={[styles.claimBtn, (!tokensAvail || busy) && styles.btnDisabled]}
                  disabled={!tokensAvail || busy}
                  onPress={() => callDaily('getDailyTokenData', [], 'Daily Tokens claimed!')}
                >
                  <Text style={styles.claimBtnTxt}>{tokensAvail ? 'Claim' : 'Claimed'}</Text>
                </Pressable>
              </View>

              <View style={styles.rewardCard}>
                <Text style={styles.cardIcon}>⭐</Text>
                <Text style={styles.cardTitle}>Daily XP</Text>
                <Text style={styles.cardSub}>Bonus experience for your shinobi</Text>
                <Pressable
                  style={[styles.claimBtn, (!xpAvail || busy) && styles.btnDisabled]}
                  disabled={!xpAvail || busy}
                  onPress={() => callDaily('claimDailyXP', [], 'Daily XP claimed!')}
                >
                  <Text style={styles.claimBtnTxt}>{xpAvail ? 'Claim' : 'Claimed'}</Text>
                </Pressable>
              </View>

              <View style={styles.rewardCard}>
                <Text style={styles.cardIcon}>⚡</Text>
                <Text style={styles.cardTitle}>Double XP Buff</Text>
                <Text style={styles.cardSub}>
                  {doubleXpTimer > 0 ? `Active: ${fmtSec(doubleXpTimer)}` : 'Activate 2x XP boost'}
                </Text>
                <Pressable
                  style={[styles.claimBtn, (doubleXpTimer > 0 || busy) && styles.btnDisabled]}
                  disabled={doubleXpTimer > 0 || busy}
                  onPress={() => callDaily('claimDoubleXP', [], 'Double XP activated!')}
                >
                  <Text style={styles.claimBtnTxt}>
                    {doubleXpTimer > 0 ? 'Active' : 'Activate'}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.rewardCard}>
                <Text style={styles.cardIcon}>📜</Text>
                <Text style={styles.cardTitle}>Scroll of Wisdom</Text>
                <Text style={styles.cardSub}>Special one-time wisdom reward</Text>
                <Pressable
                  style={[styles.claimBtn, (scrollClaimed || busy) && styles.btnDisabled]}
                  disabled={scrollClaimed || busy}
                  onPress={() => callDaily('claimScrollOfWisdom', [], 'Scroll of Wisdom claimed!')}
                >
                  <Text style={styles.claimBtnTxt}>{scrollClaimed ? 'Claimed' : 'Claim'}</Text>
                </Pressable>
              </View>
            </View>

            {/* Monthly Attendance Section */}
            <View style={styles.attBox}>
              <Text style={styles.attHeader}>
                📅 Monthly Attendance — {attCount} Day(s) Checked In
              </Text>
              {attItems.length === 0 ? (
                <Text style={styles.attEmpty}>
                  Your attendance for today has been recorded automatically!
                </Text>
              ) : (
                <View style={styles.attRow}>
                  {attItems.map((it, idx) => {
                    const claimed = attClaimed[idx] === 1;
                    const ready = attCount >= it.price && !claimed;
                    return (
                      <View key={it.id} style={styles.attTier}>
                        <Text style={styles.attDays}>{it.price} Days</Text>
                        <Text style={styles.attItem} numberOfLines={1}>
                          {it.item}
                        </Text>
                        <Pressable
                          style={[
                            styles.attBtn,
                            claimed ? styles.btnDone : ready ? styles.btnReady : styles.btnLocked,
                          ]}
                          disabled={!ready || busy}
                          onPress={() =>
                            callDaily('claimAttendanceReward', [it.id], `Claimed ${it.item}!`)
                          }
                        >
                          <Text style={styles.attBtnTxt}>
                            {claimed ? '✓ Claimed' : ready ? 'Claim' : `${attCount}/${it.price}`}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </ScrollView>
        ) : (
          /* AUTHENTIC NINJA SAGE SPINNING ROULETTE */
          <View style={styles.roulSplit}>
            {/* Left: Interactive Spinning Wheel */}
            <View style={styles.wheelStage}>
              {/* Top Crimson/Gold Pointer Arrow */}
              <View style={styles.pointerWrap} pointerEvents="none">
                <View style={styles.pointerCap} />
                <View style={styles.pointerArrow} />
              </View>

              {/* Outer Carved Wood & Gold Bezel */}
              <View style={styles.wheelBezel}>
                {/* Rotating Inner Wheel */}
                <Animated.View
                  style={[
                    styles.wheelDisc,
                    { transform: [{ rotate: wheelRotate }] },
                  ]}
                >
                  {/* 10 Radial Spokes */}
                  {ROULETTE_SLOTS.map((slot, i) => (
                    <View
                      key={`spoke_${slot.id}`}
                      style={[
                        styles.spokeLine,
                        {
                          transform: [{ rotate: `${i * SLICE_DEG + SLICE_DEG / 2}deg` }],
                        },
                      ]}
                    />
                  ))}

                  {/* 10 Prize Wedges / Medallions */}
                  {ROULETTE_SLOTS.map((slot, i) => {
                    const angleDeg = i * SLICE_DEG;
                    const rad = ((angleDeg - 90) * Math.PI) / 180;
                    const dist = WHEEL_RADIUS - 36;
                    const cx = WHEEL_RADIUS + dist * Math.cos(rad);
                    const cy = WHEEL_RADIUS + dist * Math.sin(rad);
                    const val = slot.baseAmount * streakBonus;
                    const isWinner = wonSlotId === slot.id;
                    const icon =
                      slot.type === 'tokens' ? '💎' : slot.type === 'gold' ? '🪙' : '⭐';

                    return (
                      <View
                        key={slot.id}
                        style={[
                          styles.slotPod,
                          {
                            left: cx - 23,
                            top: cy - 23,
                            backgroundColor: slot.color,
                            borderColor: isWinner ? '#FEF08A' : slot.accent,
                            borderWidth: isWinner ? 2.5 : 1.25,
                            transform: [{ rotate: `${angleDeg}deg` }],
                          },
                        ]}
                      >
                        <Text style={styles.slotIcon}>{icon}</Text>
                        <Text style={styles.slotVal}>{formatShortVal(val)}</Text>
                      </View>
                    );
                  })}

                  {/* Outer Brass Rim Studs */}
                  {ROULETTE_SLOTS.map((slot, i) => {
                    const rad = (((i * SLICE_DEG + SLICE_DEG / 2) - 90) * Math.PI) / 180;
                    const dist = WHEEL_RADIUS - 7;
                    return (
                      <View
                        key={`stud_${slot.id}`}
                        style={[
                          styles.rimStud,
                          {
                            left: WHEEL_RADIUS + dist * Math.cos(rad) - 3,
                            top: WHEEL_RADIUS + dist * Math.sin(rad) - 3,
                          },
                        ]}
                      />
                    );
                  })}
                </Animated.View>

                {/* Center Glossy SPIN Medallion */}
                <Pressable
                  style={[
                    styles.centerHub,
                    (!canSpin || spinning) && styles.centerHubDisabled,
                  ]}
                  disabled={!canSpin || spinning}
                  onPress={handleSpin}
                >
                  <Text style={styles.centerHubTxt}>{spinning ? '...' : 'SPIN'}</Text>
                </Pressable>
              </View>
            </View>

            {/* Right: Streak Bonus & Control Panel */}
            <View style={styles.roulInfoCard}>
              <View>
                <Text style={styles.roulTitle}>Shinobi Daily Roulette</Text>
                <Text style={styles.roulTier}>
                  {accountType >= 1 ? '★ Premium Emblem (2 Spins/Day)' : 'Free Ninja (1 Spin/Day)'}
                </Text>
              </View>

              <View style={styles.streakBox}>
                <Text style={styles.streakHeader}>
                  🔥 Consecutive Login Bonus: Day {streakBonus}/7 ({streakBonus}x)
                </Text>
                <View style={styles.streakRow}>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <View
                      key={d}
                      style={[
                        styles.streakDot,
                        d <= streakBonus && styles.streakDotActive,
                        d === streakBonus && styles.streakDotCurrent,
                      ]}
                    >
                      <Text
                        style={[
                          styles.streakDotTxt,
                          d <= streakBonus && styles.streakDotTxtActive,
                        ]}
                      >
                        {d}x
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {lastSpinReward ? (
                <View style={styles.winBanner}>
                  <Text style={styles.winTxt}>🎉 Won: {lastSpinReward}</Text>
                </View>
              ) : (
                <View style={styles.hintBox}>
                  <Text style={styles.hintTxt}>
                    {spinning
                      ? 'Wheel is spinning... Good luck, Shinobi!'
                      : `All wheel rewards are currently multiplied by ${streakBonus}x!`}
                  </Text>
                </View>
              )}

              <Pressable
                style={[styles.spinBtn, (!canSpin || busy || spinning) && styles.btnDisabled]}
                disabled={!canSpin || busy || spinning}
                onPress={handleSpin}
              >
                <Text style={styles.spinBtnTxt}>
                  {spinning
                    ? 'SPINNING...'
                    : canSpin
                    ? '🎡 SPIN ROULETTE'
                    : '✓ SPUN TODAY'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 6 },
  pill: {
    backgroundColor: '#3E2008',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillTxt: { color: '#FFE082', fontWeight: '800', fontSize: 12 },
  tabRow: { flexDirection: 'row', gap: 8 },
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
  tabTxt: { color: '#FFF4DC', fontWeight: '700', fontSize: 12.5 },
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
  scrollContent: { gap: 10, paddingBottom: 14 },
  cardGrid: { flexDirection: 'row', gap: 8 },
  rewardCard: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 5,
  },
  cardIcon: { fontSize: 28 },
  cardTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 13, textAlign: 'center' },
  cardSub: { color: NS_THEME.inkSoft, fontSize: 11, textAlign: 'center' },
  claimBtn: {
    width: '100%',
    backgroundColor: NS_THEME.btnGreen,
    borderWidth: 1,
    borderColor: '#3E2008',
    borderRadius: 7,
    paddingVertical: 6,
    alignItems: 'center',
  },
  claimBtnTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  btnDisabled: { opacity: 0.45 },
  attBox: {
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  attHeader: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 13 },
  attEmpty: { color: NS_THEME.inkSoft, fontSize: 12 },
  attRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  attTier: {
    flex: 1,
    minWidth: 100,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    padding: 7,
    alignItems: 'center',
    gap: 4,
  },
  attDays: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 12 },
  attItem: { color: NS_THEME.inkSoft, fontSize: 10 },
  attBtn: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  btnReady: { backgroundColor: NS_THEME.btnOrange },
  btnDone: { backgroundColor: NS_THEME.btnGreen },
  btnLocked: { backgroundColor: NS_THEME.btnDisabled },
  attBtnTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 11 },

  // Authentic Roulette Layout
  roulSplit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 6,
  },
  wheelStage: {
    width: WHEEL_SIZE + 28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pointerWrap: {
    position: 'absolute',
    top: -4,
    zIndex: 20,
    alignItems: 'center',
  },
  pointerCap: {
    width: 14,
    height: 10,
    borderRadius: 4,
    backgroundColor: '#FACC15',
    borderWidth: 1.5,
    borderColor: '#7C2D12',
  },
  pointerArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#DC2626',
    marginTop: -2,
  },
  wheelBezel: {
    width: WHEEL_SIZE + 16,
    height: WHEEL_SIZE + 16,
    borderRadius: (WHEEL_SIZE + 16) / 2,
    backgroundColor: '#5C2C0C',
    borderWidth: 4,
    borderColor: '#EAB308',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 10,
  },
  wheelDisc: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    borderRadius: WHEEL_RADIUS,
    backgroundColor: '#2A1405',
    borderWidth: 2,
    borderColor: '#FDE047',
    position: 'relative',
    overflow: 'hidden',
  },
  spokeLine: {
    position: 'absolute',
    left: WHEEL_RADIUS - 0.75,
    top: 0,
    width: 1.5,
    height: WHEEL_SIZE,
    backgroundColor: 'rgba(250, 204, 21, 0.35)',
  },
  slotPod: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 2,
    elevation: 3,
  },
  slotIcon: { fontSize: 13, lineHeight: 15 },
  slotVal: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '900', marginTop: 1 },
  rimStud: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FEF08A',
    borderWidth: 0.75,
    borderColor: '#78350F',
  },
  centerHub: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#DC2626',
    borderWidth: 3.5,
    borderColor: '#FACC15',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 8,
  },
  centerHubDisabled: {
    backgroundColor: '#78716C',
  },
  centerHubTxt: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12.5,
    letterSpacing: 0.5,
  },
  roulInfoCard: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 12,
    padding: 12,
    justifyContent: 'space-between',
    gap: 8,
  },
  roulTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 16 },
  roulTier: { color: '#B45309', fontWeight: '800', fontSize: 11.5, marginTop: 2 },
  streakBox: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    padding: 8,
    gap: 6,
  },
  streakHeader: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 11.5 },
  streakRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  streakDot: {
    flex: 1,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#D6BE8A',
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakDotActive: { backgroundColor: '#EA580C', borderColor: '#7C2D12' },
  streakDotCurrent: { borderColor: '#FEF08A', borderWidth: 2 },
  streakDotTxt: { color: NS_THEME.inkMid, fontWeight: '900', fontSize: 10.5 },
  streakDotTxtActive: { color: '#FFFFFF' },
  hintBox: {
    backgroundColor: '#FFF7E0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D9A438',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  hintTxt: { color: NS_THEME.inkMid, fontSize: 11.5, fontWeight: '700', textAlign: 'center' },
  winBanner: {
    backgroundColor: '#15803D',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#BBF7D0',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  winTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 13.5, textAlign: 'center' },
  spinBtn: {
    backgroundColor: '#D95B16',
    borderWidth: 2,
    borderColor: '#FFE082',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  spinBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
});
