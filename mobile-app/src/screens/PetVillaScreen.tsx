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

type VillaTab = 'training' | 'fusion';

interface VillaSlot {
  status: number; // 0=locked, 1=open, 2=training, 3=ready
  pet_id: number;
  skip_price: number;
  completed_at: number; // remaining seconds
}

interface VillaPet {
  pet_id: number;
  pet_name: string;
  pet_level: number;
  pet_xp: number;
  pet_swf: string;
  train_time_text: string;
  train_gold: number;
  maturity_points?: number;
}

function fmtSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(r).padStart(2, '0')}s`;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

export function PetVillaScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [tab, setTab] = useState<VillaTab>('training');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<VillaSlot[]>([]);
  const [pets, setPets] = useState<VillaPet[]>([]);
  const [boostRemaining, setBoostRemaining] = useState(0);
  const [leftPetId, setLeftPetId] = useState<number | null>(null);
  const [rightPetId, setRightPetId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  // Live 1s countdown ticker for active training slots & fusion boost
  useEffect(() => {
    const iv = setInterval(() => {
      setSlots((prev) =>
        prev.map((sl) => {
          if (sl.status === 2 && sl.completed_at > 0) {
            const nextSec = sl.completed_at - 1;
            return {
              ...sl,
              completed_at: nextSec,
              status: nextSec <= 0 ? 3 : 2,
              skip_price: Math.max(1, Math.ceil(nextSec / 60)),
            };
          }
          return sl;
        })
      );
      setBoostRemaining((b) => (b > 0 ? b - 1 : 0));
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

  const loadData = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const [villaRes, comboRes, petsRes] = await Promise.all([
        api.rpc<{ status?: number; slots?: VillaSlot[]; pets?: VillaPet[] }>(
          'PetService',
          'executeService',
          ['getVillaData', [profile.charId, sessionKey]],
          { sessionKey, charId: profile.charId }
        ),
        api.rpc<{ status?: number; boost?: number | null }>(
          'PetCombinationService',
          'getData',
          [[profile.charId, sessionKey]],
          { sessionKey, charId: profile.charId }
        ),
        api.rpc<{ status?: number; pets?: Array<{ pet_id: number; pet_mp?: number; maturity_points?: number }> }>(
          'PetService',
          'getPets',
          [[profile.charId, sessionKey]],
          { sessionKey, charId: profile.charId }
        ),
      ]);

      const mpMap = new Map<number, number>();
      for (const p of petsRes.data?.pets ?? []) {
        mpMap.set(Number(p.pet_id), Number(p.pet_mp ?? p.maturity_points ?? 0));
      }

      setSlots(villaRes.data?.slots ?? []);
      setPets(
        (villaRes.data?.pets ?? []).map((p: VillaPet) => ({
          ...p,
          maturity_points: mpMap.get(Number(p.pet_id)) ?? 0,
        }))
      );
      setBoostRemaining(Number(comboRes.data?.boost ?? 0));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to load Pet Villa.');
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!profile || !sessionKey) return null;

  const callVilla = async (subService: string, extraArgs: unknown[], okMsg: string) => {
    setBusy(true);
    try {
      const res = await api.rpc<{ status?: number; result?: string; error?: string }>(
        'PetService',
        'executeService',
        [subService, [profile.charId, sessionKey, ...extraArgs]],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setNotice(res.data?.result || okMsg);
        await Promise.all([loadData(), refreshProfile()]);
      } else {
        setNotice(res.data?.result || res.data?.error || 'Action failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleBoost = async () => {
    setBusy(true);
    try {
      const res = await api.rpc<{ status?: number; result?: string; error?: string; boost?: number }>(
        'PetCombinationService',
        'boostRate',
        [[profile.charId, sessionKey]],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setBoostRemaining(Number(res.data?.boost ?? 10800));
        setNotice(res.data?.result || 'Combine rate boosted to 80% for 3h!');
        await refreshProfile();
      } else {
        setNotice(res.data?.result || res.data?.error || 'Boost failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Boost failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCombine = async () => {
    if (!leftPetId || !rightPetId) {
      setNotice('Select 2 different pets to combine.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.rpc<{
        status?: number;
        success?: boolean;
        result?: string;
        error?: string;
        pets?: string;
      }>(
        'PetCombinationService',
        'combinePet',
        [[profile.charId, sessionKey, leftPetId, rightPetId]],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        if (res.data?.success) {
          setNotice(`Fusion SUCCESS! Received ${res.data?.pets || 'reward'}.`);
          setLeftPetId(null);
          setRightPetId(null);
        } else {
          setNotice('Fusion failed — pets kept, Maturity Points halved.');
        }
        await Promise.all([loadData(), refreshProfile()]);
      } else {
        setNotice(res.data?.result || res.data?.error || 'Fusion failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Fusion failed.');
    } finally {
      setBusy(false);
    }
  };

  const busyPetIds = new Set(slots.filter((s) => s.status === 2 || s.status === 3).map((s) => s.pet_id));

  return (
    <NinjaScrollWindow
      title="Pet Shop — Pet Villa"
      bgSource={BUILDING_BGS.petShop}
      onClose={() => navigate('hub')}
      headerCenter={
        <View style={styles.buildingTabs}>
          <Pressable style={styles.buildingTabBtn} onPress={() => navigate('petShop')}>
            <Text style={styles.buildingTabTxt}>🐾 Pet Shop</Text>
          </Pressable>
          <View style={[styles.buildingTabBtn, styles.buildingTabActive]}>
            <Text style={styles.buildingTabTxtActive}>🏡 Pet Villa</Text>
          </View>
        </View>
      }
      rightContent={
        <View style={styles.topStats}>
          <Text style={styles.topStatTxt}>
            🪙 {profile.gold.toLocaleString()} • 💎 {profile.tokens.toLocaleString()}
          </Text>
        </View>
      }
    >
      <View style={styles.container}>
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tabBtn, tab === 'training' && styles.tabBtnActive]}
            onPress={() => setTab('training')}
          >
            <Text style={[styles.tabTxt, tab === 'training' && styles.tabTxtActive]}>
              🏋️ Pet Training (4 Slots)
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, tab === 'fusion' && styles.tabBtnActive]}
            onPress={() => setTab('fusion')}
          >
            <Text style={[styles.tabTxt, tab === 'fusion' && styles.tabTxtActive]}>
              🧬 Pet Fusion (Combination)
            </Text>
          </Pressable>
        </View>

        <NinjaToast message={notice} top={6} />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
          </View>
        ) : tab === 'training' ? (
          <View style={styles.splitRow}>
            {/* Left: 4 Training Slots */}
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.leftCol} contentContainerStyle={styles.listGap}>
              {slots.map((sl, idx) => {
                const pet = pets.find((p) => p.pet_id === sl.pet_id);
                return (
                  <View key={idx} style={styles.slotCard}>
                    <View style={styles.slotHeader}>
                      <Text style={styles.slotTitle}>Training Slot #{idx + 1}</Text>
                      <Text style={styles.slotStatus}>
                        {sl.status === 0
                          ? '🔒 LOCKED'
                          : sl.status === 1
                          ? '✓ OPEN'
                          : sl.status === 2
                          ? `⏳ ${fmtSec(sl.completed_at)}`
                          : '🎉 READY'}
                      </Text>
                    </View>

                    {sl.status === 0 ? (
                      <View style={styles.slotActions}>
                        <Pressable
                          style={[styles.smallBtn, styles.btnOrange, busy && styles.btnDisabled]}
                          disabled={busy}
                          onPress={() => callVilla('unlockSlots', ['tokens'], 'Slot unlocked!')}
                        >
                          <Text style={styles.smallBtnTxt}>Unlock (400 Tokens)</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.smallBtn, styles.btnBlue, busy && styles.btnDisabled]}
                          disabled={busy}
                          onPress={() => callVilla('unlockSlots', ['kunai'], 'Slot unlocked!')}
                        >
                          <Text style={styles.smallBtnTxt}>Unlock (300 Kunai)</Text>
                        </Pressable>
                      </View>
                    ) : sl.status === 1 ? (
                      <Text style={styles.slotHint}>Select a pet on the right to start training.</Text>
                    ) : sl.status === 2 ? (
                      <View style={styles.slotBody}>
                        <Text style={styles.slotPetName}>
                          {pet ? `${pet.pet_name} (Lv.${pet.pet_level} → Lv.${pet.pet_level + 1})` : `Pet #${sl.pet_id}`}
                        </Text>
                        <View style={styles.slotActions}>
                          <Pressable
                            style={[styles.smallBtn, styles.btnOrange, busy && styles.btnDisabled]}
                            disabled={busy}
                            onPress={() => callVilla('skipTraining', [sl.pet_id], 'Training skipped!')}
                          >
                            <Text style={styles.smallBtnTxt}>Skip ({sl.skip_price} 💎)</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.smallBtn, styles.btnRed, busy && styles.btnDisabled]}
                            disabled={busy}
                            onPress={() => callVilla('cancelTraining', [sl.pet_id], 'Training cancelled.')}
                          >
                            <Text style={styles.smallBtnTxt}>Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.slotBody}>
                        <Text style={styles.slotPetName}>
                          {pet ? `${pet.pet_name} finished training!` : `Pet #${sl.pet_id} ready!`}
                        </Text>
                        <Pressable
                          style={[styles.smallBtn, styles.btnGreen, busy && styles.btnDisabled]}
                          disabled={busy}
                          onPress={() => callVilla('checkoutPet', [sl.pet_id], 'Pet leveled up!')}
                        >
                          <Text style={styles.smallBtnTxt}>Checkout (+1 Level)</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Right: Owned Pets to assign */}
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.rightCol} contentContainerStyle={styles.listGap}>
              <Text style={styles.sectionTitle}>Your Pets ({pets.length})</Text>
              {pets.length === 0 ? (
                <Text style={styles.emptyTxt}>No pets owned yet. Visit Pet Shop to adopt one!</Text>
              ) : (
                pets.map((p) => {
                  const inTrain = busyPetIds.has(p.pet_id);
                  return (
                    <View key={p.pet_id} style={styles.petRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.petName}>
                          🐾 {p.pet_name} (Lv.{p.pet_level})
                        </Text>
                        <Text style={styles.petSub}>
                          Time: {p.train_time_text} • Cost: {p.train_gold.toLocaleString()} Gold
                        </Text>
                      </View>
                      <Pressable
                        style={[
                          styles.smallBtn,
                          inTrain ? styles.btnDisabledBg : styles.btnGreen,
                          (inTrain || busy) && styles.btnDisabled,
                        ]}
                        disabled={inTrain || busy}
                        onPress={() => callVilla('trainPet', [p.pet_id], 'Training started!')}
                      >
                        <Text style={styles.smallBtnTxt}>{inTrain ? 'In Slot' : 'Train'}</Text>
                      </Pressable>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        ) : (
          /* PET FUSION / COMBINATION TAB */
          <View style={styles.fusionWrap}>
            <View style={styles.boostBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.boostTitle}>
                  Success Rate: {boostRemaining > 0 ? '80% (BOOSTED!)' : '50% (Base)'}
                </Text>
                <Text style={styles.boostSub}>
                  Requires 2 pets at Lv.30+ with 100+ Maturity Points (MP).
                  {boostRemaining > 0 ? ` Boost ends in ${fmtSec(boostRemaining)}.` : ''}
                </Text>
              </View>
              <Pressable
                style={[
                  styles.smallBtn,
                  styles.btnOrange,
                  (boostRemaining > 0 || busy) && styles.btnDisabled,
                ]}
                disabled={boostRemaining > 0 || busy}
                onPress={handleBoost}
              >
                <Text style={styles.smallBtnTxt}>
                  {boostRemaining > 0 ? 'Boost Active' : 'Boost 80% (500 💎)'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.fusionBody}>
              <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.leftCol} contentContainerStyle={styles.listGap}>
                <Text style={styles.sectionTitle}>Select 2 Pets to Fuse</Text>
                {pets.map((p) => {
                  const isLeft = leftPetId === p.pet_id;
                  const isRight = rightPetId === p.pet_id;
                  const eligible = p.pet_level >= 30 && (p.maturity_points ?? 0) >= 100;
                  return (
                    <Pressable
                      key={p.pet_id}
                      style={[
                        styles.petRow,
                        (isLeft || isRight) && styles.petRowSelected,
                      ]}
                      onPress={() => {
                        if (isLeft) setLeftPetId(null);
                        else if (isRight) setRightPetId(null);
                        else if (!leftPetId) setLeftPetId(p.pet_id);
                        else setRightPetId(p.pet_id);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.petName}>
                          🐾 {p.pet_name} (Lv.{p.pet_level})
                        </Text>
                        <Text style={styles.petSub}>
                          MP: {p.maturity_points ?? 0} • {eligible ? '✓ Eligible' : 'Need Lv.30 & 100 MP'}
                        </Text>
                      </View>
                      <Text style={styles.pickTag}>
                        {isLeft ? 'SLOT A' : isRight ? 'SLOT B' : 'PICK'}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.fusionSummary}>
                <Text style={styles.sectionTitle}>Fusion Altar</Text>
                <View style={styles.altarRow}>
                  <View style={styles.altarBox}>
                    <Text style={styles.altarLabel}>Pet A</Text>
                    <Text style={styles.altarVal}>
                      {pets.find((p) => p.pet_id === leftPetId)?.pet_name ?? 'Empty'}
                    </Text>
                  </View>
                  <Text style={styles.plusTxt}>+</Text>
                  <View style={styles.altarBox}>
                    <Text style={styles.altarLabel}>Pet B</Text>
                    <Text style={styles.altarVal}>
                      {pets.find((p) => p.pet_id === rightPetId)?.pet_name ?? 'Empty'}
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={[
                    styles.fuseBtn,
                    (!leftPetId || !rightPetId || busy) && styles.btnDisabled,
                  ]}
                  disabled={!leftPetId || !rightPetId || busy}
                  onPress={handleCombine}
                >
                  <Text style={styles.fuseBtnTxt}>{busy ? 'Combining...' : 'Combine Pets'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 8 },
  topStats: {
    backgroundColor: '#3E2008',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  topStatTxt: { color: '#FFE082', fontWeight: '800', fontSize: 12 },
  buildingTabs: {
    flexDirection: 'row',
    backgroundColor: '#3E2008',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    padding: 2,
    gap: 3,
  },
  buildingTabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 7,
  },
  buildingTabActive: {
    backgroundColor: '#D95B16',
  },
  buildingTabTxt: {
    color: '#F6E4BA',
    fontSize: 11,
    fontWeight: '800',
  },
  buildingTabTxtActive: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  tabRow: { flexDirection: 'row', gap: 8 },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: NS_THEME.tabActive, borderColor: '#FFE082' },
  tabTxt: { color: '#FFF4DC', fontWeight: '700', fontSize: 13 },
  tabTxtActive: { color: '#FFFFFF', fontWeight: '900' },
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
  splitRow: { flex: 1, flexDirection: 'row', gap: 10 },
  leftCol: { flex: 1.15 },
  rightCol: { flex: 1 },
  listGap: { gap: 7, paddingBottom: 12 },
  sectionTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 13, marginBottom: 2 },
  slotCard: {
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 9,
    gap: 6,
  },
  slotHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  slotTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 13 },
  slotStatus: { color: '#C85A17', fontWeight: '900', fontSize: 11 },
  slotHint: { color: NS_THEME.inkSoft, fontSize: 11 },
  slotBody: { gap: 6 },
  slotPetName: { color: NS_THEME.inkDark, fontWeight: '800', fontSize: 12 },
  slotActions: { flexDirection: 'row', gap: 6 },
  petRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    padding: 8,
    gap: 8,
  },
  petRowSelected: {
    backgroundColor: NS_THEME.parchmentSelected,
    borderColor: '#D95B16',
  },
  petName: { color: NS_THEME.inkDark, fontWeight: '800', fontSize: 12 },
  petSub: { color: NS_THEME.inkSoft, fontSize: 11 },
  emptyTxt: { color: NS_THEME.inkSoft, fontSize: 12, fontStyle: 'italic' },
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
  btnDisabledBg: { backgroundColor: NS_THEME.btnDisabled },
  btnDisabled: { opacity: 0.5 },
  fusionWrap: { flex: 1, gap: 8 },
  boostBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 10,
    gap: 10,
  },
  boostTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 13 },
  boostSub: { color: NS_THEME.inkSoft, fontSize: 11 },
  fusionBody: { flex: 1, flexDirection: 'row', gap: 10 },
  fusionSummary: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  altarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  altarBox: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  altarLabel: { color: NS_THEME.inkSoft, fontWeight: '700', fontSize: 11 },
  altarVal: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 13, marginTop: 4 },
  plusTxt: { color: '#D95B16', fontWeight: '900', fontSize: 22 },
  pickTag: { color: '#D95B16', fontWeight: '900', fontSize: 11 },
  fuseBtn: {
    width: '100%',
    backgroundColor: '#7C3AED',
    borderWidth: 1.5,
    borderColor: '#FFE082',
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center',
  },
  fuseBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
});
