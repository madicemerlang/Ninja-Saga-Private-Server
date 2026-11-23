import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadGameData, type SkillDef } from '../api/gameData';
import { getPvpSocket } from '../api/sockets';
import { playBgm, playClickSfx } from '../audio/audioManager';
import { buildAudioUrl, buildBattleSwfUrl } from '../config/env';
import {
  RuffleStageView,
  type RuffleStageHandle,
  type StageEvent,
} from '../stage/RuffleStageView';
import { TimelineToken } from '../components/TimelineToken';
import { useAuthStore } from '../store/useAuthStore';

interface FloatingItem {
  id: string;
  text: string;
  kind?: 'crit' | 'dodge' | 'normal' | 'cp';
  target: 'player' | 'enemy';
}

interface EndedResult {
  winnerId: number;
  isVictory: boolean;
  reason?: string;
  trophyChange?: number;
  goldReward?: number;
  xpReward?: number;
}

export function PvPBattleScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const pvpSocketUrl = useAuthStore((s) => s.pvpSocketUrl);
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.activePvpBattle);
  const setActivePvpBattle = useAuthStore((s) => s.setActivePvpBattle);
  const navigate = useAuthStore((s) => s.navigate);

  const socket = useMemo(
    () => getPvpSocket(serverUrl, pvpSocketUrl),
    [serverUrl, pvpSocketUrl]
  );

  const myCharId = profile?.charId ?? 1;
  const oppCharId = session?.opponentCharId ?? 2;
  const battleId = session?.battleId ?? '';

  const [stageReady, setStageReady] = useState(false);
  const [turn, setTurn] = useState<'my_turn' | 'opp_turn' | 'animating' | 'done'>('opp_turn');
  const [combatLog, setCombatLog] = useState('Entering live 1v1 PvP arena...');
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [floats, setFloats] = useState<FloatingItem[]>([]);
  const [endedResult, setEndedResult] = useState<EndedResult | null>(null);

  const [myHp, setMyHp] = useState(profile ? 500 + profile.level * 30 : 600);
  const [myMaxHp, setMyMaxHp] = useState(profile ? 500 + profile.level * 30 : 600);
  const [myCp, setMyCp] = useState(profile ? 200 + profile.level * 15 : 300);
  const [myMaxCp, setMyMaxCp] = useState(profile ? 200 + profile.level * 15 : 300);

  const [oppName, setOppName] = useState('Opponent Ninja');
  const [oppHp, setOppHp] = useState(600);
  const [oppMaxHp, setOppMaxHp] = useState(600);
  const [oppCp, setOppCp] = useState(300);
  const [oppMaxCp, setOppMaxCp] = useState(300);

  const pendingHitRef = useRef<(() => void) | null>(null);
  const pendingDoneRef = useRef<(() => void) | null>(null);

  const equipTag = profile
    ? `${profile.hairStyle}_${profile.clothing}_${profile.weapon}_${profile.back}`
    : '';
  const equippedSkillsKey = (profile?.equippedSkills ?? ['skill_01']).join(',');

  const myAgi = 9 + (profile?.level ?? 1) + (profile?.points?.wind ?? 0);
  const oppAgi = 10 + (profile?.level ?? 1);
  const myGauge = turn === 'my_turn' ? 100 : Math.min(85, Math.round((myAgi / Math.max(1, oppAgi)) * 80));
  const oppGauge = turn === 'opp_turn' ? 100 : Math.min(85, Math.round((oppAgi / Math.max(1, myAgi)) * 80));

  // Play battle BGM
  useEffect(() => {
    playBgm(buildAudioUrl(serverUrl, 'battle.mp3'), 0.55);
    return () => {
      playBgm(buildAudioUrl(serverUrl, 'bgm.mp3'), 0.45);
    };
  }, [serverUrl]);

  // Load skills
  useEffect(() => {
    loadGameData(serverUrl)
      .then((bundle) => {
        const ids = equippedSkillsKey.split(',').filter(Boolean);
        const resolved = ids
          .map((id) => bundle.skillsById[id])
          .filter((s): s is SkillDef => Boolean(s));
        setSkills(resolved);
      })
      .catch(() => {});
  }, [serverUrl, equippedSkillsKey]);

  // Load PvP SWF (Player Left vs Opponent Right)
  useEffect(() => {
    setStageReady(false);
    const timer = setTimeout(() => {
      const url = buildBattleSwfUrl(
        serverUrl,
        myCharId,
        `char_${oppCharId}`,
        equippedSkillsKey,
        equipTag
      );
      stageRef.current?.loadSwf(url);
    }, 350);
    return () => clearTimeout(timer);
  }, [serverUrl, myCharId, oppCharId, equippedSkillsKey, equipTag]);

  // Handle floats
  const triggerFloat = (items: FloatingItem[]) => {
    if (items.length === 0) return;
    setFloats(items);
    setTimeout(() => setFloats([]), 900);
  };

  // Socket.IO PvP Battle Listeners
  useEffect(() => {
    if (!socket || !battleId) return;

    const onAmbush = (data: { id: number }) => {
      if (data.id === myCharId) {
        setTurn('my_turn');
        setCombatLog('Your turn! Select an action.');
      } else {
        setTurn('opp_turn');
        setCombatLog(`${oppName} is choosing an action...`);
      }
    };

    const onUpdateInfo = (data: {
      stats?: Array<{ id: number; stat: { hp?: number; cp?: number; maxHp?: number; maxCp?: number } }>;
      overlays?: Array<{ id: number; txt: string; icon?: string }>;
    }) => {
      if (Array.isArray(data.stats)) {
        for (const item of data.stats) {
          if (item.id === myCharId && item.stat) {
            if (item.stat.hp !== undefined) setMyHp(item.stat.hp);
            if (item.stat.cp !== undefined) setMyCp(item.stat.cp);
            if (item.stat.maxHp !== undefined) setMyMaxHp(item.stat.maxHp);
            if (item.stat.maxCp !== undefined) setMyMaxCp(item.stat.maxCp);
          } else if (item.id === oppCharId && item.stat) {
            if (item.stat.hp !== undefined) setOppHp(item.stat.hp);
            if (item.stat.cp !== undefined) setOppCp(item.stat.cp);
            if (item.stat.maxHp !== undefined) setOppMaxHp(item.stat.maxHp);
            if (item.stat.maxCp !== undefined) setOppMaxCp(item.stat.maxCp);
          }
        }
      }
    };

    const onWeapon = (data: {
      id: number;
      dodged?: boolean;
      crit?: boolean;
      stats?: Array<{ id: number; stat: { hp: number; cp: number } }>;
      overlays?: Array<{ id: number; txt: string }>;
    }) => {
      setTurn('animating');
      const isMe = data.id === myCharId;
      const targetSide = isMe ? 'enemy' : 'player';

      const dmgTxt = data.overlays?.find((o) => o.id !== data.id)?.txt;
      const isKill = data.stats?.some((s) => s.id !== data.id && s.stat.hp <= 0);

      pendingHitRef.current = () => {
        if (data.dodged) {
          triggerFloat([{ id: String(Date.now()), text: 'DODGE', kind: 'dodge', target: targetSide }]);
          setCombatLog(`${isMe ? oppName : profile?.name} dodged the attack!`);
        } else if (dmgTxt) {
          triggerFloat([
            {
              id: String(Date.now()),
              text: `-${dmgTxt}`,
              kind: data.crit ? 'crit' : 'normal',
              target: targetSide,
            },
          ]);
          setCombatLog(`${isMe ? profile?.name : oppName} attacks for ${dmgTxt} damage!`);
        }
        if (Array.isArray(data.stats)) {
          for (const s of data.stats) {
            if (s.id === myCharId) setMyHp(s.stat.hp);
            if (s.id === oppCharId) setOppHp(s.stat.hp);
          }
        }
      };

      pendingDoneRef.current = () => {
        if (isMe) {
          socket.emit('Battle.action.finished', { battle_id: battleId });
        }
      };

      if (isMe) {
        stageRef.current?.playSequence(isKill ? 'p_atk_t0_kill' : 'p_atk_t0');
      } else {
        stageRef.current?.playSequence(isKill ? 'e_atk_s0_kill' : 'e_atk_s0');
      }
    };

    const onSkill = (data: {
      id: number;
      skill_id?: string;
      skillId?: string;
      dodged?: boolean;
      crit?: boolean;
      stats?: Array<{ id: number; stat: { hp: number; cp: number } }>;
      overlays?: Array<{ id: number; txt: string }>;
    }) => {
      setTurn('animating');
      const isMe = data.id === myCharId;
      const skId = (data.skill_id || data.skillId || 'skill_01').replace('.swf', '');
      const targetSide = isMe ? 'enemy' : 'player';

      const dmgTxt = data.overlays?.find((o) => o.id !== data.id)?.txt;
      const isKill = data.stats?.some((s) => s.id !== data.id && s.stat.hp <= 0);

      pendingHitRef.current = () => {
        if (data.dodged) {
          triggerFloat([{ id: String(Date.now()), text: 'DODGE', kind: 'dodge', target: targetSide }]);
        } else if (dmgTxt) {
          triggerFloat([
            {
              id: String(Date.now()),
              text: `-${dmgTxt}`,
              kind: data.crit ? 'crit' : 'normal',
              target: targetSide,
            },
          ]);
        }
        if (Array.isArray(data.stats)) {
          for (const s of data.stats) {
            if (s.id === myCharId) {
              setMyHp(s.stat.hp);
              setMyCp(s.stat.cp);
            }
            if (s.id === oppCharId) {
              setOppHp(s.stat.hp);
              setOppCp(s.stat.cp);
            }
          }
        }
      };

      pendingDoneRef.current = () => {
        if (isMe) {
          socket.emit('Battle.action.finished', { battle_id: battleId });
        }
      };

      if (isMe) {
        stageRef.current?.playSequence(isKill ? `skill_${skId}_t0_kill` : `skill_${skId}_t0`);
      } else {
        stageRef.current?.playSequence(isKill ? 'e_atk_s0_kill' : 'e_atk_s0');
      }
    };

    const onCharge = (data: {
      id: number;
      stat?: { hp: number; cp: number };
      stats?: Array<{ id: number; stat: { hp: number; cp: number } }>;
    }) => {
      const isMe = data.id === myCharId;
      setCombatLog(`${isMe ? profile?.name : oppName} charges chakra!`);
      if (isMe) {
        setTurn('animating');
        pendingDoneRef.current = () => {
          socket.emit('Battle.action.finished', { battle_id: battleId });
        };
        stageRef.current?.playSequence('player_charge');
      }
      if (Array.isArray(data.stats)) {
        for (const s of data.stats) {
          if (s.id === myCharId) setMyCp(s.stat.cp);
          if (s.id === oppCharId) setOppCp(s.stat.cp);
        }
      }
    };

    const onEnded = (data: {
      winner_id: number;
      loser_id: number;
      reason?: string;
      trophy_change?: number;
      gold_reward?: number;
      xp_reward?: number;
    }) => {
      setTurn('done');
      const isVictory = data.winner_id === myCharId;
      setEndedResult({
        winnerId: data.winner_id,
        isVictory,
        reason: data.reason,
        trophyChange: data.trophy_change ?? (isVictory ? 25 : -15),
        goldReward: data.gold_reward ?? (isVictory ? 300 : 50),
        xpReward: data.xp_reward ?? (isVictory ? 500 : 100),
      });

      if (isVictory) {
        stageRef.current?.playSequence('player_win');
      }
    };

    socket.on('Battle.action.ambush', onAmbush);
    socket.on('Battle.updateInfo', onUpdateInfo);
    socket.on('Battle.action.weapon', onWeapon);
    socket.on('Battle.action.skill', onSkill);
    socket.on('Battle.action.charge', onCharge);
    socket.on('Battle.ended', onEnded);

    return () => {
      socket.off('Battle.action.ambush', onAmbush);
      socket.off('Battle.updateInfo', onUpdateInfo);
      socket.off('Battle.action.weapon', onWeapon);
      socket.off('Battle.action.skill', onSkill);
      socket.off('Battle.action.charge', onCharge);
      socket.off('Battle.ended', onEnded);
    };
  }, [socket, battleId, myCharId, oppCharId, profile, oppName]);

  const handleStageEvent = (ev: StageEvent) => {
    if (ev.type === 'STAGE_READY') {
      setStageReady(true);
      setCombatLog('36 FPS PvP Battle Stage Connected!');
      return;
    }
    if (ev.type === 'ANIM_HIT') {
      const fn = pendingHitRef.current;
      pendingHitRef.current = null;
      fn?.();
      return;
    }
    if (ev.type === 'ANIM_DONE') {
      const fn = pendingDoneRef.current;
      pendingDoneRef.current = null;
      fn?.();
      return;
    }
  };

  // Player action triggers
  const handleWeapon = () => {
    if (turn !== 'my_turn' || !stageReady) return;
    playClickSfx(serverUrl);
    setTurn('animating');
    socket.emit('Battle.action.weapon', { battle_id: battleId });
  };

  const handleCharge = () => {
    if (turn !== 'my_turn' || !stageReady) return;
    playClickSfx(serverUrl);
    setTurn('animating');
    socket.emit('Battle.action.charge', { battle_id: battleId });
  };

  const handleSkill = (sk: SkillDef) => {
    if (turn !== 'my_turn' || !stageReady) return;
    playClickSfx(serverUrl);
    setTurn('animating');
    socket.emit('Battle.action.skill', {
      battle_id: battleId,
      skillId: sk.id,
    });
  };

  const handleExit = () => {
    playClickSfx(serverUrl);
    socket.emit('Battle.action.run', { battle_id: battleId });
    setActivePvpBattle(null);
    navigate('pvp');
  };

  const myHpPct = `${Math.max(0, Math.round((myHp / myMaxHp) * 100))}%` as `${number}%`;
  const myCpPct = `${Math.max(0, Math.round((myCp / myMaxCp) * 100))}%` as `${number}%`;
  const oppHpPct = `${Math.max(0, Math.round((oppHp / oppMaxHp) * 100))}%` as `${number}%`;
  const oppCpPct = `${Math.max(0, Math.round((oppCp / oppMaxCp) * 100))}%` as `${number}%`;

  const playerFloats = floats.filter((f) => f.target === 'player');
  const enemyFloats = floats.filter((f) => f.target === 'enemy');

  return (
    <SafeAreaView style={styles.root}>
      {/* Top HUD: Player vs Opponent */}
      <View style={styles.hud}>
        <View style={styles.hudCard}>
          <Text style={styles.hudName} numberOfLines={1}>
            {profile?.name ?? 'You'} (Lv.{profile?.level ?? 1})
          </Text>
          <View style={styles.barBg}>
            <View style={[styles.barHp, { width: myHpPct }]} />
          </View>
          <Text style={styles.barLabel}>
            HP {myHp}/{myMaxHp}
          </Text>
          <View style={styles.barBg}>
            <View style={[styles.barCp, { width: myCpPct }]} />
          </View>
          <Text style={styles.barLabel}>
            CP {myCp}/{myMaxCp}
          </Text>
        </View>

        <View style={styles.turnBox}>
          <Text style={styles.pvpBadge}>LIVE 1v1 PvP</Text>
          <Text style={[styles.turnText, turn === 'my_turn' && styles.myTurnText]}>
            {!stageReady
              ? 'LOADING...'
              : turn === 'my_turn'
                ? 'YOUR TURN'
                : turn === 'animating'
                  ? 'ACTION...'
                  : turn === 'done'
                    ? 'MATCH END'
                    : 'OPPONENT TURN'}
          </Text>
        </View>

        <View style={[styles.hudCard, { alignItems: 'flex-end' }]}>
          <Text style={styles.hudName} numberOfLines={1}>
            {oppName} (Opponent)
          </Text>
          <View style={styles.barBg}>
            <View style={[styles.barHp, { width: oppHpPct }]} />
          </View>
          <Text style={styles.barLabel}>
            HP {oppHp}/{oppMaxHp}
          </Text>
          <View style={styles.barBg}>
            <View style={[styles.barCp, { width: oppCpPct }]} />
          </View>
          <Text style={styles.barLabel}>
            CP {oppCp}/{oppMaxCp}
          </Text>
        </View>
      </View>

      {/* Ruffle 36 FPS Stage */}
      <View style={styles.arenaWrap}>
        <RuffleStageView
          ref={stageRef}
          baseUrl={serverUrl}
          onEvent={handleStageEvent}
        />

        <View pointerEvents="none" style={styles.leftFloatZone}>
          {playerFloats.map((f) => (
            <Text
              key={f.id}
              style={[
                styles.floatText,
                f.kind === 'crit' && styles.floatCrit,
                f.kind === 'dodge' && styles.floatDodge,
              ]}
            >
              {f.text}
            </Text>
          ))}
        </View>

        <View pointerEvents="none" style={styles.rightFloatZone}>
          {enemyFloats.map((f) => (
            <Text
              key={f.id}
              style={[
                styles.floatText,
                f.kind === 'crit' && styles.floatCrit,
                f.kind === 'dodge' && styles.floatDodge,
              ]}
            >
              {f.text}
            </Text>
          ))}
        </View>

        <View style={styles.logStrip}>
          <Text style={styles.logText}>{combatLog}</Text>
        </View>

        {endedResult && (
          <View style={styles.resultOverlay}>
            <View style={styles.resultCard}>
              <Text
                style={[
                  styles.resultTitle,
                  endedResult.isVictory ? styles.victoryColor : styles.defeatColor,
                ]}
              >
                {endedResult.isVictory ? 'VICTORY!' : 'DEFEAT'}
              </Text>
              <View style={styles.resultBody}>
                <Text style={styles.rewardLine}>
                  {endedResult.trophyChange !== undefined
                    ? `${endedResult.trophyChange >= 0 ? '+' : ''}${endedResult.trophyChange} Trophies`
                    : ''}
                </Text>
                <Text style={styles.rewardSub}>
                  +{endedResult.xpReward ?? 0} XP  •  +{endedResult.goldReward ?? 0} Gold
                </Text>
              </View>
              <Pressable style={styles.doneBtn} onPress={handleExit}>
                <Text style={styles.doneBtnText}>Back to PvP Lobby</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Authentic Ninja Saga Agility Timeline Bar */}
      <View style={styles.timelineBarWrap}>
        <View style={styles.timelineHeaderRow}>
          <View style={styles.timelineTitlePill}>
            <Text style={styles.timelineIcon}>⚡</Text>
            <Text style={styles.timelineTitleText}>AGILITY TIMELINE</Text>
          </View>
          <View style={styles.timelineActionPill}>
            <Text style={styles.timelineActionText}>READY ➔</Text>
          </View>
        </View>

        <View style={styles.timelineTrack}>
          <View style={[styles.timelineTick, { left: '25%' }]} />
          <View style={[styles.timelineTick, { left: '50%' }]} />
          <View style={[styles.timelineTick, { left: '75%' }]} />

          {/* Player Token with smooth 60fps sliding & ready pulse */}
          {myHp > 0 && (
            <TimelineToken
              id="player"
              name="YOU"
              agility={myAgi}
              gauge={myGauge}
              isActive={turn === 'my_turn'}
              isPlayer={true}
              emoji="🥷"
            />
          )}

          {/* Opponent Token with smooth 60fps sliding & ready pulse */}
          {oppHp > 0 && (
            <TimelineToken
              id="opp"
              name="RIVAL"
              agility={oppAgi}
              gauge={oppGauge}
              isActive={turn === 'opp_turn'}
              isPlayer={false}
              emoji="👺"
            />
          )}
        </View>
      </View>

      {/* Action Bar */}
      <View style={styles.actionBar}>
        <Pressable
          style={[
            styles.actBtn,
            styles.atkBtn,
            (turn !== 'my_turn' || !stageReady) && styles.disabledBtn,
          ]}
          disabled={turn !== 'my_turn' || !stageReady}
          onPress={handleWeapon}
        >
          <Text style={styles.actTitle}>Attack</Text>
          <Text style={styles.actSub}>0 CP</Text>
        </Pressable>

        <Pressable
          style={[
            styles.actBtn,
            styles.chgBtn,
            (turn !== 'my_turn' || !stageReady) && styles.disabledBtn,
          ]}
          disabled={turn !== 'my_turn' || !stageReady}
          onPress={handleCharge}
        >
          <Text style={styles.actTitle}>Charge</Text>
          <Text style={styles.actSub}>+25% CP</Text>
        </Pressable>

        {skills.slice(0, 5).map((sk) => {
          const cd = cooldowns[sk.id] ?? 0;
          const noCp = myCp < (sk.cp_cost || 0);
          const disabled = turn !== 'my_turn' || !stageReady || cd > 0 || noCp;
          return (
            <Pressable
              key={sk.id}
              style={[styles.actBtn, styles.skillBtn, disabled && styles.disabledBtn]}
              disabled={disabled}
              onPress={() => handleSkill(sk)}
            >
              <Text style={styles.actTitle} numberOfLines={1}>
                {sk.name}
              </Text>
              <Text style={styles.actSub}>
                {cd > 0 ? `CD ${cd}t` : `${sk.cp_cost} CP`}
              </Text>
            </Pressable>
          );
        })}

        <Pressable style={[styles.actBtn, styles.fleeBtn]} onPress={handleExit}>
          <Text style={styles.actTitle}>Surrender</Text>
          <Text style={styles.actSub}>Exit</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#060B14',
    padding: 8,
  },
  hud: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginBottom: 6,
  },
  hudCard: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 7,
    justifyContent: 'center',
  },
  hudName: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 3,
  },
  barBg: {
    width: '100%',
    height: 7,
    backgroundColor: '#1E293B',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barHp: {
    height: '100%',
    backgroundColor: '#22C55E',
  },
  barCp: {
    height: '100%',
    backgroundColor: '#38BDF8',
  },
  barLabel: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 1,
    marginBottom: 2,
  },
  turnBox: {
    width: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pvpBadge: {
    color: '#DC2626',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  turnText: {
    marginTop: 3,
    backgroundColor: '#1E293B',
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
    textAlign: 'center',
  },
  myTurnText: {
    backgroundColor: '#2563EB',
    color: '#FFF',
  },
  arenaWrap: {
    flex: 1,
    backgroundColor: '#0B1324',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
    position: 'relative',
  },
  leftFloatZone: {
    position: 'absolute',
    left: '16%',
    top: '24%',
    alignItems: 'center',
  },
  rightFloatZone: {
    position: 'absolute',
    right: '16%',
    top: '24%',
    alignItems: 'center',
  },
  floatText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#EF4444',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  floatCrit: {
    color: '#FACC15',
    fontSize: 25,
  },
  floatDodge: {
    color: '#A3E635',
  },
  logStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  logText: {
    color: '#E2E8F0',
    fontSize: 11,
    textAlign: 'center',
  },
  resultOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCard: {
    width: 300,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    padding: 16,
    alignItems: 'center',
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: '900',
  },
  victoryColor: {
    color: '#F59E0B',
  },
  defeatColor: {
    color: '#EF4444',
  },
  resultBody: {
    alignItems: 'center',
    marginVertical: 10,
    gap: 4,
  },
  rewardLine: {
    color: '#FACC15',
    fontSize: 16,
    fontWeight: '800',
  },
  rewardSub: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  doneBtn: {
    backgroundColor: '#EA580C',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 6,
  },
  doneBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },
  actionBar: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  actBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  atkBtn: {
    backgroundColor: '#DC2626',
  },
  chgBtn: {
    backgroundColor: '#0284C7',
  },
  skillBtn: {
    backgroundColor: '#7C3AED',
  },
  fleeBtn: {
    backgroundColor: '#334155',
    maxWidth: 68,
  },
  disabledBtn: {
    opacity: 0.4,
  },
  actTitle: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  actSub: {
    color: '#E2E8F0',
    fontSize: 9,
    marginTop: 1,
  },
  timelineBarWrap: {
    backgroundColor: '#090D16',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginHorizontal: 8,
    marginTop: 4,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  timelineTitlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  timelineIcon: {
    fontSize: 10,
    color: '#38BDF8',
  },
  timelineTitleText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  timelineActionPill: {
    backgroundColor: '#7C2D12',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: '#F97316',
  },
  timelineActionText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#FDBA74',
  },
  timelineTrack: {
    height: 18,
    backgroundColor: '#0F172A',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#334155',
    position: 'relative',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  timelineTick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#334155',
  },
  tokenBase: {
    position: 'absolute',
    height: 16,
    minWidth: 42,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 3,
    justifyContent: 'center',
    borderWidth: 1,
    zIndex: 10,
  },
  playerToken: {
    backgroundColor: '#0369A1',
    borderColor: '#38BDF8',
  },
  enemyToken: {
    backgroundColor: '#991B1B',
    borderColor: '#F87171',
  },
  activeTokenGlow: {
    borderColor: '#FACC15',
    borderWidth: 1.5,
    backgroundColor: '#D97706',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 4,
  },
  tokenEmoji: {
    fontSize: 9,
    marginRight: 2,
  },
  tokenText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  tokenAgi: {
    fontSize: 7,
    fontWeight: '700',
    color: '#CBD5E1',
    marginLeft: 2,
  },
});
