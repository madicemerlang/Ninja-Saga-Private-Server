import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MobileApiClient } from '../api/client';
import { loadGameData, type SkillDef } from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { buildPlayerSkillSwfUrl } from '../config/env';
import { getSkillElementMeta, isSkillAoE } from '../engine/battleEngine';
import { RuffleStageView, type RuffleStageHandle } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

export function MyJutsuScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [skillsById, setSkillsById] = useState<Record<string, SkillDef>>({});
  const [selectedId, setSelectedId] = useState<string>(profile?.equippedSkills[0] ?? 'skill_01');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const equipTag = profile
    ? `${profile.hairStyle}_${profile.clothing}_${profile.weapon}_${profile.back}`
    : '';

  useEffect(() => {
    loadGameData(serverUrl)
      .then((bundle) => setSkillsById(bundle.skillsById))
      .catch((err) => setNotice(String(err)))
      .finally(() => setLoading(false));
  }, [serverUrl]);

  useEffect(() => {
    if (!profile || !selectedId) return;
    const timer = setTimeout(() => {
      const url = buildPlayerSkillSwfUrl(serverUrl, profile.charId, selectedId, equipTag);
      stageRef.current?.loadSwf(url);
    }, 220);
    return () => clearTimeout(timer);
  }, [serverUrl, profile, selectedId, equipTag]);

  if (!profile) return null;

  const handleToggleEquip = async (skillId: string) => {
    if (!sessionKey) return;
    playClickSfx(serverUrl);
    const isEquipped = profile.equippedSkills.includes(skillId);
    let nextSkills: string[];
    if (isEquipped) {
      if (profile.equippedSkills.length <= 1) {
        setNotice('Minimal 1 Jutsu harus tetap terpasang.');
        return;
      }
      nextSkills = profile.equippedSkills.filter((id) => id !== skillId);
    } else {
      if (profile.equippedSkills.length >= 6) {
        setNotice('Maksimal 6 Jutsu yang bisa dipasang di Battle Bar.');
        return;
      }
      nextSkills = [...profile.equippedSkills, skillId];
    }

    setBusyId(skillId);
    setNotice(null);
    try {
      await api.rpc(
        'CharacterService',
        'equipSkillSet',
        [profile.charId, sessionKey, nextSkills.join(',')],
        { sessionKey, charId: profile.charId }
      );
      const raw = await api.getCharacter(profile.charId, sessionKey);
      setProfileFromRaw(profile.charId, raw);
      setNotice(`Battle Loadout diperbarui (${nextSkills.length}/6 Jutsu terpasang).`);
    } catch (err) {
      setNotice(String(err instanceof Error ? err.message : err));
    } finally {
      setBusyId(null);
    }
  };

  const selectedSkill = skillsById[selectedId];
  const isSelectedEquipped = profile.equippedSkills.includes(selectedId);

  return (
    <NinjaScrollWindow
      title={`My Jutsu (${profile.equippedSkills.length}/6)`}
      bgSource={BUILDING_BGS.academy}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <Pressable
          style={styles.academyBtn}
          onPress={() => {
            playClickSfx(serverUrl);
            navigate('academy');
          }}
        >
          <Text style={styles.academyTxt}>📜 Academy →</Text>
        </Pressable>
      }
    >
      {notice && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{notice}</Text>
        </View>
      )}

      <View style={styles.body}>
        {/* Left: Live 36 FPS Jutsu Preview + Details */}
        <View style={styles.previewPane}>
          <View style={styles.stageBox}>
            <RuffleStageView ref={stageRef} baseUrl={serverUrl} />
          </View>
          {selectedSkill && (
            <View style={styles.detailBox}>
              <Text style={styles.detailName} numberOfLines={1}>
                {getSkillElementMeta(selectedSkill.type).icon} {selectedSkill.name}
                {isSkillAoE(selectedSkill) ? ' [AoE]' : ''}
              </Text>
              <Text style={styles.detailMeta}>
                DMG {selectedSkill.damage} • {selectedSkill.cp_cost} CP • CD {selectedSkill.cooldown}t
              </Text>
              <Text style={styles.detailDesc} numberOfLines={2}>
                {selectedSkill.description || 'Equipped Ninja Jutsu.'}
              </Text>
              <Pressable
                style={[styles.eqBtn, isSelectedEquipped ? styles.uneqBtn : styles.doEqBtn]}
                disabled={busyId !== null}
                onPress={() => handleToggleEquip(selectedSkill.id)}
              >
                <Text style={styles.eqBtnTxt}>
                  {busyId === selectedSkill.id
                    ? '...'
                    : isSelectedEquipped
                      ? '✓ Equipped (Tap to Unequip)'
                      : '+ Equip to Battle Bar'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Right: Owned Jutsu Grid */}
        <View style={styles.listPane}>
          <Text style={styles.sectionTitle}>
            Jutsu Dimiliki ({profile.ownedSkills.length}) — Ketuk untuk Preview & Pasang
          </Text>
          {loading ? (
            <ActivityIndicator color={NS_THEME.btnOrange} style={{ marginTop: 20 }} />
          ) : (
            <ScrollView contentContainerStyle={styles.grid}>
              {profile.ownedSkills.map((sid) => {
                const def = skillsById[sid];
                const eq = profile.equippedSkills.includes(sid);
                const sel = selectedId === sid;
                return (
                  <Pressable
                    key={sid}
                    style={[
                      styles.card,
                      eq && styles.cardEq,
                      sel && styles.cardSel,
                    ]}
                    onPress={() => {
                      playClickSfx(serverUrl);
                      setSelectedId(sid);
                    }}
                  >
                    <Text style={styles.cardName} numberOfLines={1}>
                      {eq ? '★ ' : ''}
                      {def ? def.name : sid}
                    </Text>
                    <Text style={styles.cardMeta}>
                      {def ? `DMG ${def.damage} • ${def.cp_cost} CP` : sid}
                    </Text>
                    <Text style={[styles.cardStatus, eq && { color: '#15803D' }]}>
                      {eq ? 'EQUIPPED' : 'OWNED'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  academyBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  academyTxt: { color: '#FFF', fontSize: 10.5, fontWeight: '900' },
  banner: {
    backgroundColor: '#FEF3C7',
    borderColor: '#B45309',
    borderWidth: 1.5,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 5,
  },
  bannerText: { color: '#78350F', fontSize: 11, fontWeight: '800' },
  body: { flex: 1, flexDirection: 'row', gap: 8 },
  previewPane: {
    width: '38%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
    gap: 6,
  },
  stageBox: {
    flex: 1,
    backgroundColor: NS_THEME.stageDark,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    overflow: 'hidden',
  },
  detailBox: { gap: 3 },
  detailName: { color: NS_THEME.inkDark, fontSize: 12, fontWeight: '900' },
  detailMeta: { color: '#9A3412', fontSize: 10, fontWeight: '900' },
  detailDesc: { color: NS_THEME.inkMid, fontSize: 9.5, fontWeight: '600', lineHeight: 13 },
  eqBtn: {
    marginTop: 4,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    paddingVertical: 7,
    alignItems: 'center',
  },
  doEqBtn: { backgroundColor: NS_THEME.btnGreen },
  uneqBtn: { backgroundColor: NS_THEME.btnBlue },
  eqBtnTxt: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  listPane: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
  },
  sectionTitle: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900', marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 14 },
  card: {
    width: '31.8%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 6,
    gap: 2,
  },
  cardEq: { borderColor: NS_THEME.btnGreen, backgroundColor: '#E7F6E5' },
  cardSel: { borderColor: NS_THEME.btnOrange, borderWidth: 2, backgroundColor: NS_THEME.parchmentSelected },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    backgroundColor: NS_THEME.stageDark,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconImg: { width: '100%', height: '100%' },
  iconFallback: { fontSize: 15 },
  cardName: { color: NS_THEME.inkDark, fontSize: 10.5, fontWeight: '900' },
  cardMeta: { color: NS_THEME.inkSoft, fontSize: 8.5, fontWeight: '700' },
  cardStatus: { color: '#B45309', fontSize: 8.5, fontWeight: '900', marginTop: 1 },
});
