import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileApiClient, type CharacterSummary } from '../api/client';
import { playClickSfx } from '../audio/audioManager';
import { buildPlayerPreviewSwfUrl, buildPlayerSwfUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

const SELECT_CHAR_BG = require('../../assets/select_char_bg.jpg');

const ELEMENTS = [
  { id: 1, name: 'Wind', icon: '🌪️', color: '#15803D', bonus: 'Agility & Dodge' },
  { id: 2, name: 'Fire', icon: '🔥', color: '#B91C1C', bonus: 'Attack & Combustion' },
  { id: 3, name: 'Lightning', icon: '⚡', color: '#A16207', bonus: 'Critical Strike' },
  { id: 4, name: 'Earth', icon: '🪨', color: '#78350F', bonus: 'Max HP & Reflect' },
  { id: 5, name: 'Water', icon: '💧', color: '#1D4ED8', bonus: 'Max CP & Purify' },
];

const HAIR_COLORS = [
  { label: 'Black', hex: '#1E293B', code: '0|0' },
  { label: 'Crimson', hex: '#DC2626', code: '14423100|0' },
  { label: 'Gold', hex: '#FACC15', code: '16435989|0' },
  { label: 'Azure', hex: '#2563EB', code: '2450411|0' },
  { label: 'Silver', hex: '#E2E8F0', code: '14870768|0' },
  { label: 'Violet', hex: '#7C3AED', code: '8141549|0' },
  { label: 'Emerald', hex: '#10B981', code: '1096065|0' },
  { label: 'Chestnut', hex: '#92400E', code: '9584654|0' },
];

const MAX_HAIR_NUM = 20;
const TOTAL_SLOTS = 6;

export function CharSelectScreen() {
  const previewRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const uid = useAuthStore((s) => s.uid);
  const accountType = useAuthStore((s) => s.accountType);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const characters = useAuthStore((s) => s.characters);
  const setCharacters = useAuthStore((s) => s.setCharacters);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);
  const logout = useAuthStore((s) => s.logout);

  const isPremium = accountType >= 1;
  const maxUnlockedSlots = isPremium ? 6 : 1;

  const [view, setView] = useState<'select' | 'create'>('select');
  const [showTierModal, setShowTierModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CharacterSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [charName, setCharName] = useState('');
  const [gender, setGender] = useState<0 | 1>(0);
  const [hairNum, setHairNum] = useState(1);
  const [hairColor, setHairColor] = useState(HAIR_COLORS[0].code);
  const [element, setElement] = useState(3);
  const [previewBridgeReady, setPreviewBridgeReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  // Live 36 FPS Ruffle preview of the ninja being created (synced with gender, hairstyle & hair color!)
  useEffect(() => {
    if (view !== 'create' || !previewBridgeReady) return;
    const url = buildPlayerPreviewSwfUrl(serverUrl, gender, hairNum, hairColor);
    previewRef.current?.loadSwf(url);

    // Preload adjacent hairstyles, opposite gender & all hair colors into Ruffle WebView memory for 0ms switching!
    const nextHair = hairNum >= MAX_HAIR_NUM ? 1 : hairNum + 1;
    const prevHair = hairNum <= 1 ? MAX_HAIR_NUM : hairNum - 1;
    const otherGender: 0 | 1 = gender === 0 ? 1 : 0;
    const preloadUrls = [
      buildPlayerPreviewSwfUrl(serverUrl, otherGender, hairNum, hairColor),
      buildPlayerPreviewSwfUrl(serverUrl, gender, nextHair, hairColor),
      buildPlayerPreviewSwfUrl(serverUrl, gender, prevHair, hairColor),
      ...HAIR_COLORS.filter((c) => c.code !== hairColor).map((c) =>
        buildPlayerPreviewSwfUrl(serverUrl, gender, hairNum, c.code)
      ),
    ];
    previewRef.current?.preloadSwfs(preloadUrls);
  }, [view, previewBridgeReady, serverUrl, gender, hairNum, hairColor]);

  const handlePreviewEvent = (ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') setPreviewBridgeReady(true);
  };

  const enterWithCharacter = async (charId: number) => {
    if (!sessionKey) return;
    playClickSfx(serverUrl);
    setLoading(true);
    setError(null);
    try {
      const raw = await api.getCharacter(charId, sessionKey);
      setProfileFromRaw(charId, raw);
      const p = useAuthStore.getState().profile;
      if (p) {
        const tag = `${p.hairStyle}_${p.hairColor}_${p.clothing}_${p.weapon}_${p.back}`;
        const portraitUrl = buildPlayerSwfUrl(serverUrl, charId, 'standby', tag, { portrait: true });
        fetch(portraitUrl).catch(() => {});
      }
      navigate('hub');
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCharacter = async () => {
    if (!uid || !sessionKey || !deleteTarget) return;
    playClickSfx(serverUrl);
    setDeleting(true);
    setError(null);
    try {
      const res = await api.deleteCharacter(uid, sessionKey, deleteTarget.char_id);
      if (res.status !== 1) {
        setError(res.error || 'Failed to delete character.');
        return;
      }
      const listRes = await api.getCharacters(uid, sessionKey);
      const list = Array.isArray(listRes?.account_data) ? listRes.account_data : [];
      setCharacters(list);
      setDeleteTarget(null);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setDeleting(false);
    }
  };

  const handleCreate = async () => {
    if (!uid || !sessionKey) return;
    if (charName.trim().length < 2) {
      setError('Character name must be at least 2 characters.');
      return;
    }
    playClickSfx(serverUrl);
    setLoading(true);
    setError(null);
    try {
      const res = await api.createCharacter(uid, sessionKey, {
        name: charName.trim(),
        gender,
        element,
        hair_num: hairNum,
        hair_color: hairColor,
      });
      if ((res.status as number) !== 1) {
        setError(String(res.error ?? res.result ?? 'Failed to create character.'));
        return;
      }
      const listRes = await api.getCharacters(uid, sessionKey);
      const list = Array.isArray(listRes?.account_data) ? listRes.account_data : [];
      setCharacters(list);
      setCharName('');
      if (list.length > 0) {
        await enterWithCharacter(list[list.length - 1].char_id);
      } else {
        setView('select');
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  const selectedElemMeta = ELEMENTS.find((e) => e.id === element) ?? ELEMENTS[2];

  // Authentic Ninja Saga Create New Ninja Screen (Live Preview + Customization)
  if (view === 'create') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.createTopBar}>
          <Pressable
            style={styles.backBtn}
            onPress={() => {
              playClickSfx(serverUrl);
              setError(null);
              setView('select');
            }}
          >
            <Text style={styles.logoutText}>← Select Character</Text>
          </Pressable>
          <Text style={styles.createHeaderTitle}>CREATE NEW NINJA</Text>
          <View style={{ width: 112 }} />
        </View>

        <View style={styles.createSplit}>
          {/* Left: Live 36 FPS Ninja Preview Pedestal */}
          <View style={styles.previewCard}>
            <View style={styles.previewBadgeRow}>
              <View style={[styles.elemTag, { backgroundColor: selectedElemMeta.color }]}>
                <Text style={styles.elemTagTxt}>
                  {selectedElemMeta.icon} {selectedElemMeta.name}
                </Text>
              </View>
              <Text style={styles.previewGenderTxt}>
                {gender === 0 ? '♂ Male' : '♀ Female'} • Hair #{hairNum}
              </Text>
            </View>

            <View style={styles.previewStage}>
              <RuffleStageView ref={previewRef} baseUrl={serverUrl} onEvent={handlePreviewEvent} />
            </View>

            <View style={styles.previewFooter}>
              <Text style={styles.previewNameTxt} numberOfLines={1}>
                {charName.trim() || 'Unnamed Ninja'}
              </Text>
              <Text style={styles.previewBonusTxt}>
                Element Specialty: {selectedElemMeta.bonus}
              </Text>
            </View>
          </View>

          {/* Right: Authentic Ninja Saga Customization Panel */}
          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.customCard} contentContainerStyle={styles.customContent}>
            <Text style={styles.label}>Ninja Name</Text>
            <TextInput
              style={styles.input}
              value={charName}
              onChangeText={setCharName}
              placeholder="Enter ninja name..."
              placeholderTextColor="#64748B"
              maxLength={20}
            />

            <Text style={styles.label}>Gender</Text>
            <View style={styles.row}>
              <Pressable
                style={[styles.pill, gender === 0 && styles.pillActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setGender(0);
                }}
              >
                <Text style={styles.pillText}>♂ Male</Text>
              </Pressable>
              <Pressable
                style={[styles.pill, gender === 1 && styles.pillActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setGender(1);
                }}
              >
                <Text style={styles.pillText}>♀ Female</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>Hairstyle</Text>
            <View style={styles.hairStepper}>
              <Pressable
                style={styles.stepBtn}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setHairNum((n) => (n <= 1 ? MAX_HAIR_NUM : n - 1));
                }}
              >
                <Text style={styles.stepBtnTxt}>◀</Text>
              </Pressable>
              <Text style={styles.hairValTxt}>
                Style {hairNum} / {MAX_HAIR_NUM}
              </Text>
              <Pressable
                style={styles.stepBtn}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setHairNum((n) => (n >= MAX_HAIR_NUM ? 1 : n + 1));
                }}
              >
                <Text style={styles.stepBtnTxt}>▶</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>Hair Color</Text>
            <View style={styles.swatchRow}>
              {HAIR_COLORS.map((hc) => (
                <Pressable
                  key={hc.label}
                  style={[
                    styles.swatch,
                    { backgroundColor: hc.hex },
                    hairColor === hc.code && styles.swatchActive,
                  ]}
                  onPress={() => {
                    playClickSfx(serverUrl);
                    setHairColor(hc.code);
                  }}
                />
              ))}
            </View>

            <Text style={styles.label}>Starting Element</Text>
            <View style={styles.elemRow}>
              {ELEMENTS.map((el) => (
                <Pressable
                  key={el.id}
                  style={[
                    styles.elemChip,
                    element === el.id && { backgroundColor: el.color, borderColor: '#FACC15' },
                  ]}
                  onPress={() => {
                    playClickSfx(serverUrl);
                    setElement(el.id);
                  }}
                >
                  <Text style={styles.pillText}>
                    {el.icon} {el.name}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable style={styles.createBtn} onPress={handleCreate} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.createText}>Create & Enter Village</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  // Build 6 classic Ninja Saga slots (2 columns x 3 rows)
  const slots: Array<CharacterSummary | null> = Array.from(
    { length: TOTAL_SLOTS },
    (_, i) => characters[i] ?? null
  );

  // Authentic Ninja Saga "Select Character" Screen with Generated Anime Scroll Background
  return (
    <View style={styles.selectRoot}>
      <Image source={SELECT_CHAR_BG} style={styles.selectBgImg} resizeMode="cover" />

      {/* Top-Left Hanging Green Bamboo Scroll Header */}
      <View style={styles.bambooHeaderWrap}>
        <View style={styles.bambooCap} />
        <View style={styles.bambooBody}>
          <Text style={styles.bambooTitle}>Select Character</Text>
        </View>
        <View style={styles.bambooCap} />
      </View>

      {/* Top-Right Account Tier ("Free User" / "★ Premium User") + Logout */}
      <View style={styles.topRightRow}>
        <Pressable
          style={[styles.tierBadgeBtn, isPremium && styles.tierBadgePremium]}
          onPress={() => {
            playClickSfx(serverUrl);
            setShowTierModal(true);
          }}
        >
          <Text style={[styles.tierBadgeTxt, isPremium && styles.tierBadgeTxtPremium]}>
            {isPremium ? '★ Premium User' : 'Free User'}
          </Text>
        </Pressable>
        <Pressable style={styles.scrollLogoutBtn} onPress={logout}>
          <Text style={styles.scrollLogoutTxt}>Logout</Text>
        </Pressable>
      </View>

      {error && (
        <View style={styles.scrollErrorWrap}>
          <Text style={styles.scrollError}>{error}</Text>
        </View>
      )}

      {/* Right 2x3 Grid of 6 Classic Brown Ninja Saga Character Plaques inside the Scroll */}
      <View style={styles.slotsOverlay}>
        <View style={styles.slotsGrid}>
          {slots.map((char, idx) => {
            const slotUnlocked = idx < maxUnlockedSlots;

            if (char) {
              const genderLabel = Number(char.character_gender ?? 0) === 1 ? 'Female' : 'Male';
              return (
                <Pressable
                  key={`slot-${char.char_id}`}
                  style={styles.slotPlaque}
                  disabled={loading}
                  onPress={() => enterWithCharacter(char.char_id)}
                >
                  <View style={styles.flameTopRight} />
                  <View style={styles.flameBottomLeft} />
                  <Pressable
                    style={styles.deleteCharBtn}
                    disabled={loading || deleting}
                    onPress={(e) => {
                      e.stopPropagation();
                      playClickSfx(serverUrl);
                      setDeleteTarget(char);
                    }}
                  >
                    <Text style={styles.deleteCharTxt}>🗑️</Text>
                  </Pressable>
                  <Text style={styles.slotCharName} numberOfLines={1}>
                    {char.character_name}
                  </Text>
                  <View style={styles.slotMetaRow}>
                    <Text style={styles.slotMetaTxt}>Level {char.character_level}</Text>
                    <Text style={styles.slotMetaTxt}>{genderLabel}</Text>
                  </View>
                  {loading && (
                    <ActivityIndicator
                      color="#FDE047"
                      size="small"
                      style={styles.slotSpinner}
                    />
                  )}
                </Pressable>
              );
            }

            return (
              <Pressable
                key={`slot-empty-${idx}`}
                style={[styles.slotPlaque, !slotUnlocked && styles.slotPlaqueLocked]}
                disabled={loading}
                onPress={() => {
                  playClickSfx(serverUrl);
                  if (!slotUnlocked) {
                    setShowTierModal(true);
                    return;
                  }
                  setError(null);
                  setPreviewBridgeReady(false);
                  setView('create');
                }}
              >
                <View style={styles.flameTopRight} />
                <View style={styles.flameBottomLeft} />
                {slotUnlocked ? (
                  <View style={styles.greenCreateBtn}>
                    <View style={styles.greenCreateShine} />
                    <Text style={styles.greenCreateIcon}>👤</Text>
                    <Text style={styles.greenCreateTxt}>Create</Text>
                  </View>
                ) : (
                  <View style={styles.lockedSlotPill}>
                    <Text style={styles.lockedSlotTxt}>🔒 Premium Slot</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Free User vs Premium User Benefits Modal */}
      {showTierModal && (
        <Pressable style={styles.modalBackdrop} onPress={() => setShowTierModal(false)}>
          <Pressable style={styles.tierModalCard} onPress={() => {}}>
            <View style={styles.tierModalHead}>
              <Text style={styles.tierModalTitle}>
                {isPremium ? '★ Premium User (Ninja Emblem)' : 'Free User vs Premium User'}
              </Text>
              <Pressable onPress={() => setShowTierModal(false)}>
                <Text style={styles.tierModalClose}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.compareRow}>
              <View style={[styles.compareCol, !isPremium && styles.compareColActive]}>
                <Text style={styles.compareColTitle}>Free User</Text>
                <Text style={styles.compareItem}>• 1 Character Slot</Text>
                <Text style={styles.compareItem}>• Max 2 Elements</Text>
                <Text style={styles.compareItem}>• Normal EXP & Gold (100%)</Text>
                <Text style={styles.compareItem}>• Free Shop, Pet & Talent</Text>
                <Text style={styles.compareItem}>• 1x Daily Roulette Spin</Text>
              </View>
              <View style={[styles.compareCol, styles.compareColPrem, isPremium && styles.compareColActive]}>
                <Text style={[styles.compareColTitle, { color: '#FACC15' }]}>★ Premium User</Text>
                <Text style={styles.compareItem}>• 6 Character Slots</Text>
                <Text style={styles.compareItem}>• Max 3 Elements</Text>
                <Text style={styles.compareItem}>• +50% Bonus Mission EXP & Gold</Text>
                <Text style={styles.compareItem}>• Unlock Emblem Jutsu, Gear & Pets</Text>
                <Text style={styles.compareItem}>• 2x Daily Roulette & Hunting Bonus</Text>
              </View>
            </View>

            <Pressable style={styles.tierCloseBtn} onPress={() => setShowTierModal(false)}>
              <Text style={styles.tierCloseBtnTxt}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}

      {/* Delete Character Confirmation Modal */}
      {deleteTarget && (
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => !deleting && setDeleteTarget(null)}
        >
          <Pressable style={styles.deleteModalCard} onPress={() => {}}>
            <Text style={styles.deleteModalTitle}>Delete Character?</Text>
            <Text style={styles.deleteModalDesc}>
              Are you sure you want to delete{' '}
              <Text style={{ fontWeight: '900', color: '#FDE047' }}>
                {deleteTarget.character_name}
              </Text>{' '}
              (Level {deleteTarget.character_level})? Character data will be permanently lost.
            </Text>
            <Text style={styles.deleteModalSafeNote}>
              💎 Tokens are bound to your account and remain safe even if this character is deleted.
            </Text>
            <View style={styles.deleteModalBtns}>
              <Pressable
                style={styles.deleteCancelBtn}
                disabled={deleting}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={styles.deleteBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.deleteConfirmBtn}
                disabled={deleting}
                onPress={handleDeleteCharacter}
              >
                <Text style={styles.deleteBtnTxt}>
                  {deleting ? 'Deleting...' : 'Delete Permanently'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /* ── AUTHENTIC NINJA SAGA SELECT CHARACTER FULL-SCREEN UI ── */
  selectRoot: {
    flex: 1,
    backgroundColor: '#0B1324',
    position: 'relative',
    overflow: 'hidden',
  },
  deleteCharBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(153, 27, 27, 0.92)',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  deleteCharTxt: {
    fontSize: 11,
  },
  deleteModalCard: {
    width: '62%',
    maxWidth: 420,
    backgroundColor: '#2B1608',
    borderRadius: 12,
    borderWidth: 2.5,
    borderColor: '#D9A438',
    padding: 16,
    gap: 10,
  },
  deleteModalTitle: {
    color: '#FDE047',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  deleteModalDesc: {
    color: '#F8FAFC',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  deleteModalSafeNote: {
    color: '#7DD3FC',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    backgroundColor: 'rgba(14, 116, 144, 0.25)',
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  deleteModalBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  deleteCancelBtn: {
    flex: 1,
    backgroundColor: '#475569',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  deleteConfirmBtn: {
    flex: 1,
    backgroundColor: '#C62828',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  deleteBtnTxt: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  selectBgImg: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  bambooHeaderWrap: {
    position: 'absolute',
    top: '8%',
    left: '14%',
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 15,
  },
  bambooCap: {
    width: 11,
    height: 38,
    backgroundColor: '#166534',
    borderRadius: 3,
    borderWidth: 2,
    borderColor: '#1E2914',
  },
  bambooBody: {
    backgroundColor: '#E5DEC5',
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderColor: '#166534',
    paddingHorizontal: 14,
    paddingVertical: 3,
  },
  bambooTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    textShadowColor: '#000000',
    textShadowOffset: { width: 1.5, height: 1.5 },
    textShadowRadius: 2,
    letterSpacing: 0.4,
  },
  topRightRow: {
    position: 'absolute',
    top: '10%',
    right: '10%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 15,
  },
  tierBadgeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderWidth: 1.25,
    borderColor: '#C8A24A',
  },
  tierBadgePremium: {
    backgroundColor: '#78350F',
    borderColor: '#FDE047',
  },
  tierBadgeTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 1.2, height: 1.2 },
    textShadowRadius: 2,
  },
  tierBadgeTxtPremium: {
    color: '#FEF08A',
  },
  scrollLogoutBtn: {
    backgroundColor: 'rgba(127, 29, 29, 0.92)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  scrollLogoutTxt: {
    color: '#FFF',
    fontSize: 10.5,
    fontWeight: '800',
  },
  scrollErrorWrap: {
    position: 'absolute',
    top: '21%',
    left: '38%',
    right: '11%',
    zIndex: 20,
  },
  scrollError: {
    color: '#FEF2F2',
    backgroundColor: 'rgba(153, 27, 27, 0.9)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 10.5,
    fontWeight: '800',
    textAlign: 'center',
  },
  slotsOverlay: {
    position: 'absolute',
    left: '39%',
    right: '11%',
    top: '26%',
    bottom: '22%',
    justifyContent: 'center',
    zIndex: 12,
  },
  slotsGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignContent: 'center',
  },
  slotPlaque: {
    width: '48%',
    height: '30%',
    minHeight: 56,
    backgroundColor: '#6E3513',
    borderRadius: 9,
    borderWidth: 2.5,
    borderColor: '#2B1306',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 3,
    elevation: 4,
  },
  slotPlaqueLocked: {
    backgroundColor: '#4A2611',
    opacity: 0.85,
  },
  flameTopRight: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: '#F59E0B',
    opacity: 0.85,
  },
  flameBottomLeft: {
    position: 'absolute',
    bottom: -6,
    left: -6,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: '#F59E0B',
    opacity: 0.85,
  },
  slotCharName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  slotMetaRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingHorizontal: 6,
  },
  slotMetaTxt: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '800',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  slotSpinner: {
    position: 'absolute',
    right: 8,
    top: 8,
  },
  greenCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#15803D',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#052E16',
    paddingHorizontal: 16,
    paddingVertical: 5,
    overflow: 'hidden',
    position: 'relative',
  },
  greenCreateShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(134, 239, 172, 0.35)',
  },
  greenCreateIcon: {
    fontSize: 12,
  },
  greenCreateTxt: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  lockedSlotPill: {
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C8A24A',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  lockedSlotTxt: {
    color: '#FDE68A',
    fontSize: 10,
    fontWeight: '800',
  },

  /* ── FREE VS PREMIUM BENEFITS MODAL ── */
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  tierModalCard: {
    width: 440,
    maxWidth: '92%',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#C8A24A',
    padding: 14,
    gap: 10,
  },
  tierModalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tierModalTitle: {
    color: '#FACC15',
    fontSize: 14,
    fontWeight: '900',
  },
  tierModalClose: {
    color: '#CBD5E1',
    fontSize: 16,
    fontWeight: '900',
  },
  compareRow: {
    flexDirection: 'row',
    gap: 8,
  },
  compareCol: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 9,
    gap: 4,
  },
  compareColPrem: {
    backgroundColor: '#1E1B10',
    borderColor: '#C8A24A',
  },
  compareColActive: {
    borderWidth: 2,
    borderColor: '#22C55E',
  },
  compareColTitle: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 2,
  },
  compareItem: {
    color: '#CBD5E1',
    fontSize: 10.5,
    fontWeight: '600',
  },
  tierCloseBtn: {
    backgroundColor: '#EA580C',
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: 'center',
  },
  tierCloseBtnTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
  },

  /* ── CREATE NEW NINJA SCREEN ── */
  root: {
    flex: 1,
    backgroundColor: '#070E1A',
    padding: 10,
  },
  createTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C8A24A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  createHeaderTitle: {
    color: '#FACC15',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  createSplit: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  previewCard: {
    width: '40%',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#C8A24A',
    padding: 8,
    justifyContent: 'space-between',
  },
  previewBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  elemTag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  elemTagTxt: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
  },
  previewGenderTxt: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  previewStage: {
    flex: 1,
    marginVertical: 6,
    backgroundColor: '#060B14',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  previewFooter: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  previewNameTxt: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '900',
  },
  previewBonusTxt: {
    color: '#FACC15',
    fontSize: 9.5,
    fontWeight: '700',
    marginTop: 1,
  },
  customCard: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 12,
  },
  customContent: {
    paddingVertical: 8,
    paddingBottom: 14,
  },
  hairStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 4,
  },
  stepBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 6,
  },
  stepBtnTxt: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '900',
  },
  hairValTxt: {
    color: '#FACC15',
    fontSize: 12,
    fontWeight: '800',
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#475569',
  },
  swatchActive: {
    borderColor: '#FACC15',
    borderWidth: 2.5,
    transform: [{ scale: 1.12 }],
  },
  backBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  logoutText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  label: {
    color: '#CBD5E1',
    fontSize: 10.5,
    fontWeight: '700',
    marginTop: 7,
    marginBottom: 3,
  },
  input: {
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12.5,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  pillActive: {
    backgroundColor: '#2563EB',
    borderColor: '#7DD3FC',
  },
  pillText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '800',
  },
  elemRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  elemChip: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  errorText: {
    color: '#F87171',
    fontSize: 11,
    marginTop: 6,
  },
  createBtn: {
    marginTop: 10,
    backgroundColor: '#EA580C',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FACC15',
  },
  createText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
  },
});
