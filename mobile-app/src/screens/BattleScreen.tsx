import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileApiClient, type BattleFinishResponse } from '../api/client';
import {
  loadGameData,
  loadLibraryData,
  type EnemyDef,
  type RawSkillEffectDef,
  type SkillDef,
} from '../api/gameData';
import { playBgm, playClickSfx } from '../audio/audioManager';
import { buildAudioUrl, buildBattleSwfUrl } from '../config/env';
import {
  advanceAgilityTimeline,
  buildEnemyCombatant,
  buildPlayerCombatant,
  executeEnemyTurn,
  executePlayerAction,
  getEffectiveAgility,
  getEffectiveSkillCpCost,
  isChargeDisabled,
  isSkillsRestricted,
  processTurnStart,
  type Combatant,
  type FloatingNumber,
  type StatusEffect,
  type TimelineParticipant,
  type TurnOutcome,
} from '../engine/battleEngine';
import { TimelineToken } from '../components/TimelineToken';
import {
  RuffleStageView,
  type RuffleStageHandle,
  type StageEvent,
} from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

export function BattleScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const activeBattle = useAuthStore((s) => s.activeBattle);
  const patchProfileStats = useAuthStore((s) => s.patchProfileStats);
  const setActiveBattle = useAuthStore((s) => s.setActiveBattle);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const initialEnemies: Combatant[] = useMemo(() => {
    const raw = (activeBattle?.enemies ?? []).slice(0, 3);
    if (raw.length === 0) {
      return [
        {
          id: 'ene_01',
          name: 'Training Dummy',
          level: 1,
          hp: 120,
          maxHp: 120,
          cp: 60,
          maxCp: 60,
          agility: 8,
          baseDamage: 12,
          critChance: 0.05,
          dodgeChance: 0.03,
          statuses: [],
        },
      ];
    }
    return raw.map((e, idx) => buildEnemyCombatant(e, idx));
  }, [activeBattle]);

  const [player, setPlayer] = useState<Combatant>(() =>
    buildPlayerCombatant(profile?.name ?? 'Ninja', profile?.level ?? 1, profile?.points, 0)
  );
  const [enemies, setEnemies] = useState<Combatant[]>(initialEnemies);
  const [targetIdx, setTargetIdx] = useState(0);
  const [timelineGauges, setTimelineGauges] = useState<Record<string, number>>({});
  const [activeActorId, setActiveActorId] = useState<string | null>('player');
  const [turnCount, setTurnCount] = useState(0);

  const gaugesRef = useRef<Record<string, number>>({});
  const playerRef = useRef(player);
  playerRef.current = player;
  const enemiesRef = useRef(enemies);
  enemiesRef.current = enemies;
  const cooldownsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setEnemies(initialEnemies);
    const firstAlive = initialEnemies.findIndex((e) => e.hp > 0);
    setTargetIdx(firstAlive !== -1 ? firstAlive : 0);

    const initGauges: Record<string, number> = { player: 0 };
    initialEnemies.forEach((_, idx) => {
      initGauges[`ene_${idx}`] = 0;
    });
    setTimelineGauges(initGauges);
    gaugesRef.current = initGauges;
  }, [initialEnemies]);

  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  cooldownsRef.current = cooldowns;
  const skillEffectsByIdRef = useRef<Record<string, RawSkillEffectDef[]>>({});
  const enemiesByIdRef = useRef<Record<string, EnemyDef>>({});
  const [stageReady, setStageReady] = useState(false);
  const [turn, setTurn] = useState<'player' | 'animating' | 'done'>('player');
  const [combatLog, setCombatLog] = useState<string>(
    `Loading 36 FPS Unified Battle Stage...`
  );
  const [floats, setFloats] = useState<FloatingNumber[]>([]);
  const [finishResult, setFinishResult] = useState<BattleFinishResponse | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Refs for exact SWF ExternalInterface (__onHit / __onDone) synchronization
  const pendingHitRef = useRef<(() => void) | null>(null);
  const pendingDoneRef = useRef<(() => void) | null>(null);

  const charId = profile?.charId ?? 1;
  const equipTag = profile
    ? `${profile.hairStyle}_${profile.clothing}_${profile.weapon}_${profile.back}`
    : '';
  const equippedSkillsKey = (profile?.equippedSkills ?? ['skill_01']).join(',');
  const enemiesCsv = useMemo(
    () => initialEnemies.map((e) => e.id).join(','),
    [initialEnemies]
  );

  // Load equipped skills metadata + equipped weapon damage bonus
  useEffect(() => {
    Promise.all([loadGameData(serverUrl), loadLibraryData(serverUrl)])
      .then(([bundle, lib]) => {
        const ids = equippedSkillsKey.split(',').filter(Boolean);
        const resolved = ids
          .map((id) => bundle.skillsById[id])
          .filter((s): s is SkillDef => Boolean(s));
        setSkills(resolved);
        skillEffectsByIdRef.current = bundle.skillEffectsById ?? {};
        enemiesByIdRef.current = bundle.enemiesById ?? {};

        const wpnDmg = profile?.weapon ? (lib.itemsById[profile.weapon]?.damage ?? 0) : 0;
        if (profile) {
          const boosted = buildPlayerCombatant(profile.name, profile.level, profile.points, wpnDmg);
          setPlayer((prev) => ({
            ...prev,
            maxHp: boosted.maxHp,
            hp: boosted.maxHp,
            maxCp: boosted.maxCp,
            cp: boosted.maxCp,
            baseDamage: boosted.baseDamage,
            weaponDamage: wpnDmg,
            points: profile.points,
            critChance: boosted.critChance,
            dodgeChance: boosted.dodgeChance,
          }));
        }
      })
      .catch(() => {});
  }, [serverUrl, equippedSkillsKey, profile]);

  // Play Battle BGM on mount and restore Village BGM when leaving
  useEffect(() => {
    playBgm(buildAudioUrl(serverUrl, 'battle.mp3'), 0.55);
    return () => {
      playBgm(buildAudioUrl(serverUrl, 'bgm.mp3'), 0.45);
    };
  }, [serverUrl]);

  // Load ONE Unified 36 FPS Battle SWF containing Player + ALL 1..3 Enemies + Skills!
  useEffect(() => {
    setStageReady(false);
    const timer = setTimeout(() => {
      const battleSwfUrl = buildBattleSwfUrl(
        serverUrl,
        charId,
        enemiesCsv,
        equippedSkillsKey,
        equipTag
      );
      stageRef.current?.loadSwf(battleSwfUrl);
    }, 350);
    return () => clearTimeout(timer);
  }, [serverUrl, charId, enemiesCsv, equippedSkillsKey, equipTag]);

  const showFloats = (items: FloatingNumber[]) => {
    if (items.length === 0) return;
    setFloats(items);
    setTimeout(() => setFloats([]), 900);
  };

  const concludeBattle = async (victory: boolean) => {
    setTurn('done');
    if (!profile || !sessionKey || !activeBattle) return;
    setFinishing(true);
    try {
      const res = await api.battleFinish(
        profile.charId,
        sessionKey,
        activeBattle.mission.id,
        activeBattle.token,
        victory
      );
      setFinishResult(res);
      patchProfileStats({ level: res.level, xp: res.xp, gold: res.gold });
      if (res.level_up) {
        api
          .getCharacter(profile.charId, sessionKey)
          .then((raw) => useAuthStore.getState().setProfileFromRaw(profile.charId, raw))
          .catch(() => {});
      }
    } catch (err) {
      setCombatLog(`Finish error: ${String(err)}`);
    } finally {
      setFinishing(false);
    }
  };

  const handleStageEvent = (ev: StageEvent) => {
    if (ev.type === 'STAGE_READY') {
      setStageReady(true);
      setCombatLog(
        `Battle started: ${activeBattle?.mission.name ?? 'Mission'} (${initialEnemies.length} enemy)!`
      );
      // Start the Agility Timeline!
      setTimeout(() => {
        stepTimeline(playerRef.current, enemiesRef.current, cooldownsRef.current);
      }, 250);
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

  // Agility Timeline Step: advances timeline gauges and determines the next actor based on Effective Agility!
  const stepTimeline = (
    curPlayer: Combatant,
    curEnemies: Combatant[],
    curCd: Record<string, number>
  ) => {
    if (curPlayer.hp <= 0 || curEnemies.every((e) => e.hp <= 0)) {
      return;
    }

    const participants: TimelineParticipant[] = [
      {
        id: 'player',
        name: curPlayer.name,
        agility: getEffectiveAgility(curPlayer),
        isPlayer: true,
        isAlive: curPlayer.hp > 0,
      },
      ...curEnemies.map((e, idx) => ({
        id: `ene_${idx}`,
        name: e.name,
        agility: getEffectiveAgility(e),
        isPlayer: false,
        isAlive: e.hp > 0,
      })),
    ];

    const { actorId, nextGauges } = advanceAgilityTimeline(participants, gaugesRef.current);
    gaugesRef.current = nextGauges;
    setTimelineGauges({ ...nextGauges });
    setActiveActorId(actorId);
    setTurnCount((c) => c + 1);

    if (actorId === 'player') {
      // Tick start-of-turn Buffs/Debuffs (Water Purify, Burn, Poison, Regen, Stun, Chaos, etc.)
      const startRes = processTurnStart(curPlayer, 'player');
      setPlayer(startRes.combatant);
      if (startRes.floats.length > 0) {
        showFloats(startRes.floats);
      }

      if (startRes.diedFromDot) {
        setCombatLog(startRes.log ?? `${curPlayer.name} fell to status effects!`);
        concludeBattle(false);
        return;
      }

      if (startRes.skipTurn) {
        setTurn('animating');
        setCombatLog(startRes.log ?? `${curPlayer.name} cannot act (${startRes.skipReason})!`);
        setTimeout(() => {
          gaugesRef.current['player'] = 0;
          setTimelineGauges({ ...gaugesRef.current });
          setActiveActorId(null);
          stepTimeline(startRes.combatant, enemiesRef.current, curCd);
        }, 780);
        return;
      }

      const firstAlive = curEnemies.findIndex((e) => e.hp > 0);
      if (firstAlive !== -1) {
        setTargetIdx((prev) => (curEnemies[prev]?.hp > 0 ? prev : firstAlive));
      }
      setTurn('player');
      setCombatLog(
        startRes.log
          ? `${startRes.log} Your turn!`
          : `Your turn! (Agility: ${getEffectiveAgility(startRes.combatant)})`
      );
    } else if (actorId.startsWith('ene_')) {
      const enemyIdx = parseInt(actorId.replace('ene_', ''), 10);
      const enemy = curEnemies[enemyIdx];
      if (!enemy || enemy.hp <= 0) {
        gaugesRef.current[actorId] = 0;
        stepTimeline(curPlayer, curEnemies, curCd);
        return;
      }

      setTurn('animating');

      // Tick enemy's start-of-turn Buffs/Debuffs (Burn, Poison, Regen, Stun, Sleep, Frozen, Chaos)
      const startRes = processTurnStart(enemy, 'enemy');
      const enemiesAfterStart = curEnemies.map((e, i) =>
        i === enemyIdx ? startRes.combatant : e
      );
      setEnemies(enemiesAfterStart);
      if (startRes.floats.length > 0) {
        showFloats(startRes.floats);
      }

      if (startRes.diedFromDot) {
        setCombatLog(startRes.log ?? `${enemy.name} succumbed to status effects!`);
        const allDeadAfterDot = enemiesAfterStart.every((e) => e.hp <= 0);
        if (allDeadAfterDot) {
          setTimeout(() => {
            pendingDoneRef.current = () => concludeBattle(true);
            stageRef.current?.playSequence('player_win');
          }, 500);
        } else {
          setTimeout(() => {
            gaugesRef.current[`ene_${enemyIdx}`] = 0;
            setTimelineGauges({ ...gaugesRef.current });
            setActiveActorId(null);
            stepTimeline(curPlayer, enemiesAfterStart, curCd);
          }, 750);
        }
        return;
      }

      if (startRes.skipTurn) {
        setCombatLog(startRes.log ?? `${enemy.name} is ${startRes.skipReason} and skips their turn!`);
        setTimeout(() => {
          gaugesRef.current[`ene_${enemyIdx}`] = 0;
          setTimelineGauges({ ...gaugesRef.current });
          setActiveActorId(null);
          stepTimeline(curPlayer, enemiesAfterStart, curCd);
        }, 780);
        return;
      }

      setCombatLog(
        startRes.log
          ? `${startRes.log} ${enemy.name}'s turn!`
          : `${enemy.name}'s turn! (Agility: ${getEffectiveAgility(startRes.combatant)})`
      );

      // Smooth delay so the player sees the enemy token glide into the ACTION zone on the timeline bar!
      setTimeout(() => {
        const attacker = enemiesRef.current[enemyIdx];
        const latestPlayer = playerRef.current;
        if (!attacker || attacker.hp <= 0 || latestPlayer.hp <= 0) return;

        // Reset enemy's gauge immediately when attack begins so token glides to 0 during action
        gaugesRef.current[`ene_${enemyIdx}`] = 0;
        setTimelineGauges({ ...gaugesRef.current });
        setActiveActorId(null);

        // Pick one of the enemy's off-cooldown authentic attacks from enemy.json (exact dmg, cooldown & effects)
        const enemyMeta = enemiesByIdRef.current[attacker.id];
        const atkPool = (enemyMeta?.attacks ?? []).map((atk, idx) => ({ ...atk, index: idx }));
        const readyPool = atkPool.filter((atk) => !((attacker.attackCooldowns?.[atk.index] ?? 0) > 0));
        const usablePool = readyPool.length > 0 ? readyPool : atkPool;
        const chosenAtk =
          usablePool.length > 0
            ? usablePool[Math.floor(Math.random() * usablePool.length)]
            : undefined;

        const enemyOut: TurnOutcome = executeEnemyTurn(
          latestPlayer,
          attacker,
          curCd,
          chosenAtk?.effects,
          chosenAtk
        );
        const playerKilled = enemyOut.player.hp <= 0;
        const enemiesAfterAtk = enemiesRef.current.map((e, i) =>
          i === enemyIdx ? enemyOut.enemy : e
        );
        const allEnemiesDeadAfterReflect = enemiesAfterAtk.every((e) => e.hp <= 0);

        pendingHitRef.current = () => {
          setPlayer(enemyOut.player);
          setEnemies(enemiesAfterAtk);
          setCooldowns(enemyOut.cooldowns);
          setCombatLog(enemyOut.log);
          showFloats(enemyOut.floats);
        };

        pendingDoneRef.current = () => {
          if (playerKilled) {
            concludeBattle(false);
          } else if (allEnemiesDeadAfterReflect) {
            pendingDoneRef.current = () => concludeBattle(true);
            stageRef.current?.playSequence('player_win');
          } else {
            stepTimeline(enemyOut.player, enemiesAfterAtk, enemyOut.cooldowns);
          }
        };

        stageRef.current?.playSequence(
          playerKilled ? `e_atk_s${enemyIdx}_kill` : `e_atk_s${enemyIdx}`
        );
      }, 650);
    }
  };

  const handlePlayerMove = (
    action: { type: 'attack' } | { type: 'charge' } | { type: 'skill'; skill: SkillDef }
  ) => {
    if (turn !== 'player' || !stageReady) return;
    playClickSfx(serverUrl);

    // Ensure target is an alive enemy
    const activeTargetIdx =
      enemies[targetIdx] && enemies[targetIdx].hp > 0
        ? targetIdx
        : enemies.findIndex((e) => e.hp > 0);
    if (activeTargetIdx === -1) return;

    const targetEnemy = enemies[activeTargetIdx];
    const skEffects =
      action.type === 'skill' ? skillEffectsByIdRef.current[action.skill.id] : undefined;
    const outcome = executePlayerAction(player, targetEnemy, cooldowns, action, skEffects);
    setCooldowns(outcome.cooldowns);
    setTurn('animating');

    // Reset player's gauge immediately upon initiating move so token glides back to 0 during the attack
    gaugesRef.current['player'] = 0;
    setTimelineGauges({ ...gaugesRef.current });
    setActiveActorId(null);

    const updatedEnemies = enemies.map((e, i) =>
      i === activeTargetIdx ? outcome.enemy : e
    );
    const targetKilled = outcome.enemy.hp <= 0;
    const aliveSlotsAfter = updatedEnemies
      .map((e, i) => (e.hp > 0 ? i : -1))
      .filter((i) => i !== -1);
    const allEnemiesDead = aliveSlotsAfter.length === 0;

    if (action.type === 'skill') {
      setPlayer(outcome.player);
      setCombatLog(`${player.name} casts ${action.skill.name} on ${targetEnemy.name}!`);
    }

    pendingHitRef.current = () => {
      setPlayer(outcome.player);
      setEnemies(updatedEnemies);
      setCombatLog(outcome.log);
      showFloats(outcome.floats);
      if (targetKilled && !allEnemiesDead) {
        setTargetIdx(aliveSlotsAfter[0]);
      }
    };

    pendingDoneRef.current = () => {
      if (allEnemiesDead) {
        pendingDoneRef.current = () => concludeBattle(true);
        stageRef.current?.playSequence('player_win');
      } else {
        stepTimeline(outcome.player, updatedEnemies, outcome.cooldowns);
      }
    };

    if (action.type === 'charge') {
      stageRef.current?.playSequence('player_charge');
    } else if (action.type === 'attack') {
      stageRef.current?.playSequence(
        targetKilled ? `p_atk_t${activeTargetIdx}_kill` : `p_atk_t${activeTargetIdx}`
      );
    } else if (action.type === 'skill') {
      const seqName = targetKilled
        ? `skill_${action.skill.id}_t${activeTargetIdx}_kill`
        : `skill_${action.skill.id}_t${activeTargetIdx}`;
      stageRef.current?.playSequence(seqName);
    }
  };

  const handleExit = () => {
    playClickSfx(serverUrl);
    setActiveBattle(null);
    navigate('missions');
  };

  const hpPct = (c: Combatant) => `${Math.max(0, Math.round((c.hp / c.maxHp) * 100))}%`;
  const cpPct = (c: Combatant) => `${Math.max(0, Math.round((c.cp / c.maxCp) * 100))}%`;

  const playerFloats = floats.filter((f) => f.target === 'player');
  const enemyFloats = floats.filter((f) => f.target === 'enemy');
  const allDead = enemies.every((e) => e.hp <= 0);
  const skillsSealed = isSkillsRestricted(player);
  const chargeLocked = isChargeDisabled(player);

  const renderStatusBadges = (statuses?: StatusEffect[]) => {
    if (!statuses || statuses.length === 0) return null;
    return (
      <View style={styles.statusRow}>
        {statuses.slice(0, 5).map((st) => (
          <View
            key={st.id}
            style={[
              styles.statusPill,
              st.type === 'Buff' ? styles.statusPillBuff : styles.statusPillDebuff,
            ]}
          >
            <Text style={styles.statusText}>
              {st.icon} {st.shortCode} {st.turns}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Top HUD: Player vs 1..3 Simultaneous Enemies */}
      <View style={styles.hud}>
        <View style={styles.hudCard}>
          <Text style={styles.hudName} numberOfLines={1}>
            {player.name} (Lv.{player.level})
          </Text>
          <View style={styles.barBg}>
            <View style={[styles.barHp, { width: hpPct(player) as `${number}%` }]} />
          </View>
          <Text style={styles.barLabel}>
            HP {player.hp}/{player.maxHp}
          </Text>
          <View style={styles.barBg}>
            <View style={[styles.barCp, { width: cpPct(player) as `${number}%` }]} />
          </View>
          <Text style={styles.barLabel}>
            CP {player.cp}/{player.maxCp}
          </Text>
          {renderStatusBadges(player.statuses)}
        </View>

        <View style={styles.turnBox}>
          <Text style={styles.missionTitle} numberOfLines={1}>
            {activeBattle?.mission.name ?? 'Battle'}
          </Text>
          <Text style={styles.turnBadge}>
            {!stageReady
              ? 'LOADING STAGE...'
              : turn === 'player'
                ? enemies.length > 1
                  ? 'YOUR TURN (TAP TARGET)'
                  : 'YOUR TURN'
                : turn === 'animating'
                  ? 'ACTION...'
                  : 'BATTLE END'}
          </Text>
        </View>

        <View style={styles.enemiesHud}>
          {enemies.map((en, idx) => {
            const dead = en.hp <= 0;
            const selected = idx === targetIdx && !dead;
            return (
              <Pressable
                key={`${en.id}-${idx}`}
                style={[
                  styles.enemyMiniCard,
                  selected && styles.enemyMiniSelected,
                  dead && styles.enemyMiniDead,
                ]}
                onPress={() => !dead && setTargetIdx(idx)}
                disabled={dead}
              >
                <View style={styles.enemyRowTop}>
                  <Text style={styles.enemyMiniName} numberOfLines={1}>
                    {selected ? '🎯 ' : ''}
                    {en.name}
                  </Text>
                  <Text style={styles.enemyMiniHp}>
                    {dead ? 'KO' : `${en.hp}/${en.maxHp}`}
                  </Text>
                </View>
                <View style={styles.barBgSmall}>
                  <View style={[styles.barHp, { width: hpPct(en) as `${number}%` }]} />
                </View>
                {!dead && renderStatusBadges(en.statuses)}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Center Unified 36 FPS Stage (1 WebView, 1 Ruffle Instance, 1..3 Simultaneous Enemies!) */}
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
                f.kind === 'cp' && styles.floatCp,
                f.kind === 'dodge' && styles.floatDodge,
                f.kind === 'heal' && styles.floatHeal,
                f.kind === 'buff' && styles.floatBuff,
                f.kind === 'debuff' && styles.floatDebuff,
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
                f.kind === 'cp' && styles.floatCp,
                f.kind === 'dodge' && styles.floatDodge,
                f.kind === 'heal' && styles.floatHeal,
                f.kind === 'buff' && styles.floatBuff,
                f.kind === 'debuff' && styles.floatDebuff,
              ]}
            >
              {f.text}
            </Text>
          ))}
        </View>

        <View style={styles.logStrip}>
          <Text style={styles.logText}>{combatLog}</Text>
        </View>

        {turn === 'done' && finishResult && (
          <View style={styles.resultOverlay}>
            <View style={styles.resultCard}>
              <Text style={styles.resultTitle}>
                {allDead ? 'VICTORY!' : 'DEFEAT'}
              </Text>
              {finishing ? (
                <ActivityIndicator color="#F59E0B" style={{ marginVertical: 12 }} />
              ) : (
                <View style={styles.resultBody}>
                  <Text style={styles.rewardLine}>
                    +{finishResult.xp_reward} XP  •  +{finishResult.gold_reward} Gold
                  </Text>
                  <Text style={styles.rewardSub}>
                    Current: Lv.{finishResult.level} | Total Gold: {finishResult.gold}
                  </Text>
                  {finishResult.level_up && (
                    <Text style={styles.levelUp}>LEVEL UP! (+1 Attribute Point)</Text>
                  )}
                </View>
              )}
              <Pressable style={styles.doneBtn} onPress={handleExit}>
                <Text style={styles.doneBtnText}>Back to Missions</Text>
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
          {/* Milestone markers */}
          <View style={[styles.timelineTick, { left: '25%' }]} />
          <View style={[styles.timelineTick, { left: '50%' }]} />
          <View style={[styles.timelineTick, { left: '75%' }]} />

          {/* Player Token with smooth 60fps sliding & ready pulse */}
          {player.hp > 0 && (
            <TimelineToken
              id="player"
              name="YOU"
              agility={getEffectiveAgility(player)}
              gauge={timelineGauges['player'] ?? 0}
              isActive={activeActorId === 'player'}
              isPlayer={true}
              emoji="🥷"
              turnKey={turnCount}
            />
          )}

          {/* Enemies Tokens with smooth 60fps sliding & ready pulse */}
          {enemies.map((en, idx) => {
            if (en.hp <= 0) return null;
            const gauge = timelineGauges[`ene_${idx}`] ?? 0;
            const isActive = activeActorId === `ene_${idx}`;
            return (
              <TimelineToken
                key={`timeline-en-${en.id}-${idx}`}
                id={`ene_${idx}`}
                name={enemies.length > 1 ? `E${idx + 1}` : 'FOE'}
                agility={getEffectiveAgility(en)}
                gauge={gauge}
                isActive={isActive}
                isPlayer={false}
                emoji="👺"
                turnKey={turnCount}
              />
            );
          })}
        </View>
      </View>

      {/* Bottom Action Bar */}
      <View style={styles.actionBar}>
        <Pressable
          style={[
            styles.actBtn,
            styles.atkBtn,
            (turn !== 'player' || !stageReady) && styles.disabledBtn,
          ]}
          disabled={turn !== 'player' || !stageReady}
          onPress={() => handlePlayerMove({ type: 'attack' })}
        >
          <Text style={styles.actTitle}>Attack</Text>
          <Text style={styles.actSub}>0 CP</Text>
        </Pressable>

        <Pressable
          style={[
            styles.actBtn,
            styles.chgBtn,
            (turn !== 'player' || !stageReady || chargeLocked) && styles.disabledBtn,
          ]}
          disabled={turn !== 'player' || !stageReady || chargeLocked}
          onPress={() => handlePlayerMove({ type: 'charge' })}
        >
          <Text style={styles.actTitle}>Charge</Text>
          <Text style={styles.actSub}>{chargeLocked ? 'LOCKED' : '+25% CP'}</Text>
        </Pressable>

        {skills.slice(0, 6).map((sk) => {
          const cd = cooldowns[sk.id] ?? 0;
          const effCpCost = getEffectiveSkillCpCost(player, sk.cp_cost || 0);
          const noCp = player.cp < effCpCost;
          const disabled = turn !== 'player' || !stageReady || cd > 0 || noCp || skillsSealed;
          return (
            <Pressable
              key={sk.id}
              style={[styles.actBtn, styles.skillBtn, disabled && styles.disabledBtn]}
              disabled={disabled}
              onPress={() => handlePlayerMove({ type: 'skill', skill: sk })}
            >
              <Text style={styles.actTitle} numberOfLines={1}>
                {sk.name}
              </Text>
              <Text style={styles.actSub}>
                {skillsSealed ? 'SEALED' : cd > 0 ? `CD ${cd}t` : `${effCpCost} CP`}
              </Text>
            </Pressable>
          );
        })}

        <Pressable style={[styles.actBtn, styles.fleeBtn]} onPress={handleExit}>
          <Text style={styles.actTitle}>Flee</Text>
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
    height: 7,
    backgroundColor: '#1E293B',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barBgSmall: {
    height: 5,
    backgroundColor: '#1E293B',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 2,
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
    width: 155,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missionTitle: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
  },
  turnBadge: {
    marginTop: 4,
    backgroundColor: '#EA580C',
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
    textAlign: 'center',
  },
  enemiesHud: {
    flex: 1.2,
    gap: 3,
    justifyContent: 'center',
  },
  enemyMiniCard: {
    backgroundColor: '#0F172A',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  enemyMiniSelected: {
    borderColor: '#F59E0B',
    backgroundColor: '#1E293B',
  },
  enemyMiniDead: {
    opacity: 0.45,
  },
  enemyRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  enemyMiniName: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  enemyMiniHp: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 6,
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
    left: '14%',
    top: '22%',
    alignItems: 'center',
  },
  rightFloatZone: {
    position: 'absolute',
    right: '14%',
    top: '22%',
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
  floatCp: {
    color: '#38BDF8',
  },
  floatDodge: {
    color: '#A3E635',
  },
  floatBuff: {
    color: '#FB923C',
    fontSize: 16,
    fontWeight: '900',
  },
  floatDebuff: {
    color: '#E879F9',
    fontSize: 16,
    fontWeight: '900',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    marginTop: 3,
  },
  statusPill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.75,
  },
  statusPillBuff: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: '#34D399',
  },
  statusPillDebuff: {
    backgroundColor: 'rgba(239, 68, 68, 0.22)',
    borderColor: '#F87171',
  },
  statusText: {
    color: '#F8FAFC',
    fontSize: 8,
    fontWeight: '800',
  },
  floatHeal: {
    color: '#4ADE80',
    fontSize: 22,
    fontWeight: '900',
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
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCard: {
    width: 320,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    padding: 16,
    alignItems: 'center',
  },
  resultTitle: {
    color: '#F59E0B',
    fontSize: 22,
    fontWeight: '900',
  },
  resultBody: {
    alignItems: 'center',
    marginVertical: 10,
    gap: 4,
  },
  rewardLine: {
    color: '#FACC15',
    fontSize: 15,
    fontWeight: '800',
  },
  rewardSub: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  levelUp: {
    color: '#4ADE80',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 4,
  },
  doneBtn: {
    backgroundColor: '#EA580C',
    paddingHorizontal: 20,
    paddingVertical: 9,
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
