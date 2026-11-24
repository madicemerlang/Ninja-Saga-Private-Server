import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { buildBattleSwfUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';
import { NS_THEME } from './NinjaScrollWindow';

interface JutsuPreviewModalProps {
  visible: boolean;
  title: string;
  swfUrl: string | null;
  skillId?: string | null;
  serverUrl: string;
  onClose: () => void;
}

function extractSkillId(swfUrl: string | null, explicit?: string | null): string | null {
  if (explicit) return explicit.replace(/\.swf$/i, '');
  if (!swfUrl) return null;
  const m = swfUrl.match(/\/(?:skills|skill)\/(skill_[a-zA-Z0-9_-]+)/i);
  return m ? m[1] : null;
}

export function JutsuPreviewModal({
  visible,
  title,
  swfUrl,
  skillId,
  serverUrl,
  onClose,
}: JutsuPreviewModalProps) {
  const stageRef = useRef<RuffleStageHandle>(null);
  const profile = useAuthStore((s) => s.profile);
  const [ready, setReady] = useState(false);

  const resolvedSkillId = useMemo(
    () => extractSkillId(swfUrl, skillId),
    [swfUrl, skillId]
  );

  const equipTag = profile
    ? `${profile.hairStyle}_${profile.hairColor}_${profile.clothing}_${profile.weapon}_${profile.back}`
    : '';

  // Compile full live battle preview with player character vs Training Dummy (ene_9001)
  const effectiveUrl = useMemo(() => {
    if (!visible) return null;
    if (resolvedSkillId && profile) {
      return buildBattleSwfUrl(
        serverUrl,
        profile.charId,
        'ene_9001',
        resolvedSkillId,
        equipTag,
        'mission_01'
      );
    }
    return swfUrl;
  }, [visible, resolvedSkillId, profile, serverUrl, equipTag, swfUrl]);

  useEffect(() => {
    setReady(false);
    if (!visible || !effectiveUrl) return;
    stageRef.current?.loadSwf(effectiveUrl);
  }, [visible, effectiveUrl]);

  const playJutsu = useCallback(() => {
    if (!resolvedSkillId) return;
    stageRef.current?.playSequence(`skill_${resolvedSkillId}_t0`);
  }, [resolvedSkillId]);

  const handleStageEvent = useCallback(
    (ev: StageEvent) => {
      if (ev.type === 'STAGE_READY') {
        setReady(true);
        if (resolvedSkillId) {
          setTimeout(() => {
            stageRef.current?.playSequence(`skill_${resolvedSkillId}_t0`);
          }, 260);
        }
      }
    },
    [resolvedSkillId]
  );

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              🎬 {title} {resolvedSkillId ? '• vs Training Dummy' : ''}
            </Text>
            {resolvedSkillId ? (
              <Pressable
                style={[styles.replayBtn, !ready && styles.replayBtnDisabled]}
                disabled={!ready}
                onPress={playJutsu}
              >
                <Text style={styles.replayTxt}>🔄 Replay</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeTxt}>✕</Text>
            </Pressable>
          </View>
          <View style={styles.stageBox}>
            {visible ? (
              <RuffleStageView
                ref={stageRef}
                baseUrl={serverUrl}
                onEvent={handleStageEvent}
              />
            ) : null}
            {visible && !ready ? (
              <View style={styles.loadingOverlay} pointerEvents="none">
                <ActivityIndicator color="#FDE047" size="large" />
                <Text style={styles.loadingTxt}>Loading Training Dummy &amp; Jutsu...</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  card: {
    width: 540,
    maxWidth: '96%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorderDark,
    padding: 10,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    color: NS_THEME.inkDark,
    fontSize: 13,
    fontWeight: '900',
    flex: 1,
  },
  replayBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderRadius: 7,
    borderWidth: 1.25,
    borderColor: '#3E2008',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  replayBtnDisabled: { opacity: 0.45 },
  replayTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  closeBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NS_THEME.btnRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  stageBox: {
    width: '100%',
    height: 255,
    backgroundColor: NS_THEME.stageDark,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    overflow: 'hidden',
    position: 'relative',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 12, 6, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingTxt: {
    color: '#FDE68A',
    fontSize: 11.5,
    fontWeight: '800',
  },
});
