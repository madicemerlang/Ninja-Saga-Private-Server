import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { MobileApiClient, type BattleFinishResponse } from '../api/client';
import {
  loadGameData,
  loadLibraryData,
  loadPetsJson,
  type EnemyDef,
  type PetJsonDef,
  type RawSkillEffectDef,
  type SkillDef,
} from '../api/gameData';
import { playBgm, playClickSfx } from '../audio/audioManager';
import {
  AttackActionTile,
  ChargeActionTile,
  FleeActionTile,
  ItemActionTile,
  JutsuActionTile,
} from '../components/BattleActionIcons';
import { FloatingPopup } from '../components/FloatingPopup';
import { LoadingScreenOverlay } from '../components/LoadingScreenOverlay';
import { TimelineToken } from '../components/TimelineToken';
import {
  buildAudioUrl,
  buildBattleSwfUrl,
  buildIconSheetSwfUrl,
  buildSkillIconsSwfUrl,
} from '../config/env';
import {
  advanceAgilityTimeline,
  applyNpcStatusEffect,
  attemptFlee,
  buildEnemyCombatant,
  buildPetCombatant,
  buildPlayerCombatant,
  chooseAutoBattleAction,
  executeConsumableAction,
  executeEnemyTurn,
  executePetTurn,
  executePlayerActionMulti,
  getEffectiveAgility,
  getEffectiveCritChance,
  getEffectiveSkillCpCost,
  getEffectiveUnitAccuracyChance,
  getEffectiveUnitDodgeChance,
  getOutgoingDamageMultiplier,
  getSkillElementMeta,
  isChargeDisabled,
  isSkillAoE,
  isSkillsRestricted,
  processTurnStart,
  type BattleConsumable,
  type Combatant,
  type FloatingNumber,
  type StatusEffect,
  type TimelineParticipant,
  type TurnOutcome,
} from '../engine/battleEngine';
import {
  RuffleStageView,
  type RuffleStageHandle,
  type StageEvent,
} from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

interface BattleConsumableTile {
  id: string;
  name: string;
  icon: string;
  desc: string;
  qty: number;
  swfId: string;
  level: number;
  borderColor: string;
  bgColor: string;
  effectKind: 'hp' | 'cp' | 'purify';
  restoreAmount: number;
}

function buildOwnedBattleConsumables(
  ownedItems: Record<string, number> | undefined,
  itemsById: Record<string, { name?: string; level?: number; description?: string }>
): BattleConsumableTile[] {
  if (!ownedItems) return [];
  const list: BattleConsumableTile[] = [];
  for (const [rawId, qty] of Object.entries(ownedItems)) {
    if (!qty || qty <= 0) continue;
    // Skip Smoke Bomb (item_01) since Flee is direct 100% Forfeit
    if (rawId === 'item_01') continue;
    const def = itemsById[rawId];
    const name = def?.name || rawId;
    const desc = def?.description || '';
    const lower = `${name} ${desc}`.toLowerCase();
    const lv = Math.max(1, Number(def?.level ?? 1));

    const numMatch = desc.match(/(\d+)\s*(hp|cp)/i);
    const parsedAmt = numMatch ? Number(numMatch[1]) : 0;

    let effectKind: 'hp' | 'cp' | 'purify' = 'hp';
    let borderColor = '#EF4444';
    let bgColor = '#450A0A';
    let icon = '🧪';

    if (lower.includes('chakra') || lower.includes(' cp')) {
      effectKind = 'cp';
      borderColor = '#38BDF8';
      bgColor = '#082F49';
      icon = '💧';
    } else if (lower.includes('purif') || lower.includes('antidote') || lower.includes('debuff') || lower.includes('cleanse')) {
      effectKind = 'purify';
      borderColor = '#34D399';
      bgColor = '#064E3B';
      icon = '✨';
    }

    list.push({
      id: rawId,
      name,
      icon,
      desc: desc || 'Consumable scroll',
      qty,
      swfId: rawId,
      level: lv,
      borderColor,
      bgColor,
      effectKind,
      restoreAmount: parsedAmt,
    });
  }
  return list.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
}

const SWF_ARENA_W = 860;
const SWF_ARENA_H = 440;
const SWF_PLAYER_X = 220;
const SWF_PLAYER_Y = 255;
const SWF_CHAR_CENTER_Y_OFFSET = 30; // Mid-torso height above ground origin (y=0) at CHAR_SCALE=0.25
const UNIT_PLATE_W = 106;
const UNIT_PLATE_H = 44;

const SWF_ENEMY_FORMATIONS: Record<number, Array<[number, number]>> = {
  1: [[630, 255]],
  2: [
    [630, 255],
    [630, 168],
  ],
  3: [
    [630, 255],
    [630, 168],
    [630, 328],
  ],
};

const SWF_ALLY_POS: Array<[number, number]> = [
  [220, 168],
  [220, 328],
];

/**
 * Exact mathematical inverse of Ruffle's `scale: 'noBorder'` transform.
 * Projects any SWF stage coordinate (swfX, swfY) on 860x440 to exact screen pixels (x, y)
 * so HP & CP bars lock pixel-perfectly to every character on ANY screen aspect ratio!
 */
function swfToScreen(
  swfX: number,
  swfY: number,
  stageW: number,
  stageH: number
): { x: number; y: number; scale: number } {
  const scale = Math.max(stageW / SWF_ARENA_W, stageH / SWF_ARENA_H);
  const offsetX = (stageW - SWF_ARENA_W * scale) / 2;
  const offsetY = (stageH - SWF_ARENA_H * scale) / 2;
  return {
    x: offsetX + swfX * scale,
    y: offsetY + swfY * scale,
    scale,
  };
}

export function BattleScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const winDims = useWindowDimensions();
  const [stageSize, setStageSize] = useState({ width: winDims.width, height: winDims.height });
  const [atbTrackWidth, setAtbTrackWidth] = useState(360);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const activeBattle = useAuthStore((s) => s.activeBattle);
  // Snapshot recruitedTeam ONCE on battle mount so clearing the team on victory/defeat NEVER reloads the SWF or restarts battle!
  const [battleTeam] = useState(() => useAuthStore.getState().recruitedTeam);
  const clearTeam = useAuthStore((s) => s.clearTeam);
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

  const initialAllies: Combatant[] = useMemo(
    () =>
      battleTeam.slice(0, 2).map((m) => {
        const lv = Math.max(1, m.level || 1);
        const maxHp = Math.max(100, m.hp || 100 + lv * 40);
        const maxCp = Math.max(80, m.cp || 100 + lv * 40);
        return {
          id: m.id,
          name: m.name,
          level: lv,
          hp: maxHp,
          maxHp,
          cp: maxCp,
          maxCp,
          agility: Math.max(8, m.agility || 10 + lv),
          baseDamage: Math.max(16, 14 + lv * 6),
          critChance: 0.12,
          dodgeChance: 0.08,
          statuses: [],
        };
      }),
    [battleTeam]
  );

  const [player, setPlayer] = useState<Combatant>(() =>
    buildPlayerCombatant(profile?.name ?? 'Ninja', profile?.level ?? 1, profile?.points, 0)
  );
  const [pet, setPet] = useState<Combatant | null>(null);
  const petDefRef = useRef<PetJsonDef | undefined>(undefined);
  const [allies, setAllies] = useState<Combatant[]>(initialAllies);
  const [enemies, setEnemies] = useState<Combatant[]>(initialEnemies);
  const [targetIdx, setTargetIdx] = useState(0);
  const [timelineGauges, setTimelineGauges] = useState<Record<string, number>>({});
  const [activeActorId, setActiveActorId] = useState<string | null>('player');
  const [turnCount, setTurnCount] = useState(0);

  // Ninja Horizon Battle Controls (always locked at 1.5x speed)
  const speed: 1.5 = 1.5;
  const [autoBattle, setAutoBattle] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [consumables, setConsumables] = useState<BattleConsumableTile[]>([]);
  const [inspectedSkill, setInspectedSkill] = useState<SkillDef | null>(null);
  const [inspectedUnit, setInspectedUnit] = useState<{ side: 'player' | 'ally' | 'enemy'; idx: number } | null>(null);
  const [showFleeModal, setShowFleeModal] = useState(false);

  const speedRef = useRef<1 | 1.5>(1.5);
  speedRef.current = speed;
  const autoRef = useRef(false);
  autoRef.current = autoBattle;
  const gaugesRef = useRef<Record<string, number>>({});
  const playerRef = useRef(player);
  playerRef.current = player;
  const petRef = useRef<Combatant | null>(pet);
  petRef.current = pet;
  const alliesRef = useRef<Combatant[]>(allies);
  alliesRef.current = allies;
  const enemiesRef = useRef(enemies);
  enemiesRef.current = enemies;
  const cooldownsRef = useRef<Record<string, number>>({});
  const usedItemsRef = useRef<Record<string, number>>({});
  const statsInitializedRef = useRef(false);
  const mountedRef = useRef(true);

  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [skillIcons, setSkillIcons] = useState<Record<string, string>>({});
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  cooldownsRef.current = cooldowns;
  const skillEffectsByIdRef = useRef<Record<string, RawSkillEffectDef[]>>({});
  const allSkillsByIdRef = useRef<Record<string, SkillDef>>({});
  const enemiesByIdRef = useRef<Record<string, EnemyDef>>({});
  const npcsByIdRef = useRef<
    Record<
      string,
      {
        id: string;
        name: string;
        attacks?: Array<{
          cooldown?: number;
          animation?: string;
          posType?: string;
          dmg?: number;
          multi_hit?: boolean;
          effects?: Array<{
            type?: string;
            target?: string;
            effect?: string;
            effect_name?: string;
            duration?: number;
            amount?: number;
            calc_type?: string;
          }>;
        }>;
      }
    >
  >({});
  const allyCooldownsRef = useRef<Record<number, Record<string, number>>>({});
  const [stageReady, setStageReady] = useState(false);
  const [turn, setTurn] = useState<'player' | 'animating' | 'done'>('animating');
  const turnRef = useRef<'player' | 'animating' | 'done'>('animating');
  turnRef.current = turn;
  const [combatLog, setCombatLog] = useState<string>('Loading Ninja Horizon 36 FPS Battle Stage...');
  const [floats, setFloats] = useState<FloatingNumber[]>([]);
  const [finishResult, setFinishResult] = useState<BattleFinishResponse | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Refs for SWF ExternalInterface (__onHit / __onDone) + anti-soft-lock watchdogs
  const pendingHitRef = useRef<(() => void) | null>(null);
  const pendingDoneRef = useRef<(() => void) | null>(null);
  const hitWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const stage = stageRef.current;
    return () => {
      mountedRef.current = false;
      if (hitWatchdogRef.current) clearTimeout(hitWatchdogRef.current);
      if (doneWatchdogRef.current) clearTimeout(doneWatchdogRef.current);
      stage?.clearStage();
    };
  }, []);

  const clearWatchdogs = useCallback(() => {
    if (hitWatchdogRef.current) {
      clearTimeout(hitWatchdogRef.current);
      hitWatchdogRef.current = null;
    }
    if (doneWatchdogRef.current) {
      clearTimeout(doneWatchdogRef.current);
      doneWatchdogRef.current = null;
    }
  }, []);

  const armSequenceCallbacks = useCallback(
    (onHit: (() => void) | null, onDone: (() => void) | null) => {
      clearWatchdogs();
      let hitFired = false;
      let doneFired = false;

      const fireHit = () => {
        if (hitFired || !mountedRef.current) return;
        hitFired = true;
        pendingHitRef.current = null;
        if (hitWatchdogRef.current) {
          clearTimeout(hitWatchdogRef.current);
          hitWatchdogRef.current = null;
        }
        onHit?.();
      };

      const fireDone = () => {
        if (doneFired || !mountedRef.current) return;
        if (!hitFired && onHit) fireHit();
        doneFired = true;
        pendingDoneRef.current = null;
        clearWatchdogs();
        onDone?.();
      };

      pendingHitRef.current = onHit ? fireHit : null;
      pendingDoneRef.current = onDone ? fireDone : null;

      const sp = speedRef.current;
      if (onHit) {
        hitWatchdogRef.current = setTimeout(fireHit, Math.round(3200 / sp));
      }
      if (onDone) {
        doneWatchdogRef.current = setTimeout(fireDone, Math.round(6500 / sp));
      }
    },
    [clearWatchdogs]
  );

  // Disabled WebView screen-shake on Crit to prevent Android SurfaceFlinger WebGL texture re-upload stutter!
  const triggerCritShake = useCallback(() => {}, []);

  const pushFloats = useCallback((items: FloatingNumber[]) => {
    if (items.length === 0) return;
    setFloats((prev) => [...prev.slice(-10), ...items]);
  }, []);

  const removeFloat = useCallback((id: number) => {
    setFloats((prev) => prev.filter((f) => f.id !== id));
  }, []);

  useEffect(() => {
    setEnemies(initialEnemies);
    setAllies(initialAllies);
    const firstAlive = initialEnemies.findIndex((e) => e.hp > 0);
    setTargetIdx(firstAlive !== -1 ? firstAlive : 0);

    const initGauges: Record<string, number> = { player: 0 };
    if (petRef.current) initGauges['pet'] = 0;
    initialAllies.forEach((_, idx) => {
      initGauges[`ally_${idx}`] = 0;
    });
    initialEnemies.forEach((_, idx) => {
      initGauges[`ene_${idx}`] = 0;
    });
    setTimelineGauges(initGauges);
    gaugesRef.current = initGauges;
  }, [initialEnemies, initialAllies]);

  const charId = profile?.charId ?? 1;
  const equipTag = profile
    ? `${profile.hairStyle}_${profile.clothing}_${profile.weapon}_${profile.back}`
    : '';
  const equippedSkillsKey = (profile?.equippedSkills ?? ['skill_01']).join(',');
  const enemiesCsv = useMemo(
    () => initialEnemies.map((e) => e.id).join(','),
    [initialEnemies]
  );
  const alliesCsv = useMemo(
    () => initialAllies.map((a) => a.id).join(','),
    [initialAllies]
  );
  const missionBg = activeBattle?.mission.bg ?? 'mission_01';

  // Load skills, weapon damage, equipped pet metadata, and authentic NPC jutsu definitions ONCE per battle
  useEffect(() => {
    Promise.all([
      loadGameData(serverUrl),
      loadLibraryData(serverUrl),
      loadPetsJson(serverUrl).catch(() => ({} as Record<string, PetJsonDef>)),
      fetch(`${serverUrl.replace(/\/+$/, '')}/game_data/npc.json`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ])
      .then(([bundle, lib, petsById, rawNpcs]) => {
        if (!mountedRef.current) return;
        const npcMap: typeof npcsByIdRef.current = {};
        if (Array.isArray(rawNpcs)) {
          for (const n of rawNpcs) {
            if (n?.id && !npcMap[n.id]) {
              npcMap[n.id] = n;
            }
          }
        }
        npcsByIdRef.current = npcMap;
        const ids = equippedSkillsKey.split(',').filter(Boolean);
        const resolved = ids
          .map((id) => bundle.skillsById[id])
          .filter((s): s is SkillDef => Boolean(s));
        setSkills(resolved);
        allSkillsByIdRef.current = bundle.skillsById ?? {};
        skillEffectsByIdRef.current = bundle.skillEffectsById ?? {};
        enemiesByIdRef.current = bundle.enemiesById ?? {};

        if (!statsInitializedRef.current && profile) {
          statsInitializedRef.current = true;
          setConsumables(buildOwnedBattleConsumables(profile.ownedItems, lib.itemsById ?? {}));
          const wpnDmg = profile.weapon ? (lib.itemsById[profile.weapon]?.damage ?? 0) : 0;
          const boosted = buildPlayerCombatant(profile.name, profile.level, profile.points, wpnDmg);
          setPlayer(boosted);

          if (profile.equippedPet) {
            const rawPet = (profile.raw?.pet_data ?? {}) as Record<string, unknown>;
            const petSwfId = String(rawPet.pet_swf ?? rawPet.swf ?? `pet_${profile.equippedPet}`);
            const matchedPet =
              petsById[petSwfId] ??
              Object.values(petsById).find((p) => p.id === petSwfId) ??
              Object.values(petsById)[0];
            if (matchedPet) {
              petDefRef.current = matchedPet;
              const petComb = buildPetCombatant(
                { ...matchedPet, level: Number(rawPet.pet_level ?? profile.level) || profile.level },
                profile.level
              );
              setPet(petComb);
              gaugesRef.current['pet'] = 0;
              setTimelineGauges({ ...gaugesRef.current });
            }
          }
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

  // Load ONE Unified 36 FPS Battle SWF (Mission BG + Player + 1..3 Enemies + Dressed Skills!)
  useEffect(() => {
    setStageReady(false);
    const timer = setTimeout(() => {
      const battleSwfUrl = buildBattleSwfUrl(
        serverUrl,
        charId,
        enemiesCsv,
        equippedSkillsKey,
        equipTag,
        missionBg,
        alliesCsv
      );
      stageRef.current?.loadSwf(battleSwfUrl);
    }, 300);
    return () => clearTimeout(timer);
  }, [serverUrl, charId, enemiesCsv, equippedSkillsKey, equipTag, missionBg, alliesCsv]);

  const toggleAuto = () => {
    playClickSfx(serverUrl);
    setAutoBattle((prev) => !prev);
  };

  const concludeBattle = useCallback(
    async (victory: boolean) => {
      clearWatchdogs();
      clearTeam();
      setTurn('done');
      setAutoBattle(false);
      if (!profile || !sessionKey || !activeBattle) return;
      setFinishing(true);
      try {
        const usedSnapshot = { ...usedItemsRef.current };
        const hasUsedItems = Object.keys(usedSnapshot).length > 0;
        const examCtx = activeBattle.examContext;

        if (examCtx) {
          if (victory) {
            await api.rpc(
              examCtx.service,
              'finishStage',
              [sessionKey, profile.charId, examCtx.stageId],
              { sessionKey, charId: profile.charId }
            );
          }
          if (hasUsedItems) {
            api
              .battleFinish(profile.charId, sessionKey, activeBattle.mission.id, activeBattle.token, false, usedSnapshot)
              .catch(() => {});
          }
          if (!mountedRef.current) return;
          usedItemsRef.current = {};
          setFinishResult({
            status: 1,
            victory,
            xp_reward: 0,
            gold_reward: 0,
            level: profile.level,
            xp: profile.xp,
            gold: profile.gold,
            level_up: false,
          });
          api
            .getCharacter(profile.charId, sessionKey)
            .then((raw) => useAuthStore.getState().setProfileFromRaw(profile.charId, raw))
            .catch(() => {});
          return;
        }

        const res = await api.battleFinish(
          profile.charId,
          sessionKey,
          activeBattle.mission.id,
          activeBattle.token,
          victory,
          hasUsedItems ? usedSnapshot : undefined
        );
        if (!mountedRef.current) return;
        usedItemsRef.current = {};
        setFinishResult(res);
        patchProfileStats({ level: res.level, xp: res.xp, gold: res.gold });
        if (res.level_up || hasUsedItems || (res.dropped_items && res.dropped_items.length > 0)) {
          api
            .getCharacter(profile.charId, sessionKey)
            .then((raw) => useAuthStore.getState().setProfileFromRaw(profile.charId, raw))
            .catch(() => {});
        }
      } catch (err) {
        if (mountedRef.current) setCombatLog(`Finish error: ${String(err)}`);
      } finally {
        if (mountedRef.current) setFinishing(false);
      }
    },
    [activeBattle, api, clearWatchdogs, patchProfileStats, profile, sessionKey]
  );

  // Agility Timeline Step: advances ATB gauges and determines the next actor (Player, Pet, or Enemy)
  const stepTimeline = useCallback(
    (curPlayer: Combatant, curEnemies: Combatant[], curCd: Record<string, number>) => {
      if (!mountedRef.current) return;
      if (curPlayer.hp <= 0) {
        concludeBattle(false);
        return;
      }
      if (curEnemies.every((e) => e.hp <= 0)) {
        armSequenceCallbacks(null, () => concludeBattle(true));
        stageRef.current?.playSequence('player_win');
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
        ...(petRef.current
          ? [
              {
                id: 'pet',
                name: petRef.current.name,
                agility: getEffectiveAgility(petRef.current),
                isPlayer: true,
                isAlive: true,
              },
            ]
          : []),
        ...alliesRef.current.map((al, idx) => ({
          id: `ally_${idx}`,
          name: al.name,
          agility: getEffectiveAgility(al),
          isPlayer: true,
          isAlive: al.hp > 0,
        })),
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

      const delayScale = speedRef.current > 1 ? 0.68 : 1.0;

      // ── PLAYER TURN ──
      if (actorId === 'player') {
        const startRes = processTurnStart(curPlayer, 'player');
        setPlayer(startRes.combatant);
        if (startRes.floats.length > 0) pushFloats(startRes.floats);

        if (startRes.diedFromDot) {
          setCombatLog(startRes.log ?? `${curPlayer.name} fell to status effects!`);
          concludeBattle(false);
          return;
        }

        if (startRes.skipTurn) {
          setTurn('animating');
          setCombatLog(startRes.log ?? `${curPlayer.name} cannot act (${startRes.skipReason})!`);
          setTimeout(() => {
            if (!mountedRef.current) return;
            gaugesRef.current['player'] = 0;
            setTimelineGauges({ ...gaugesRef.current });
            setActiveActorId(null);
            stepTimeline(startRes.combatant, enemiesRef.current, curCd);
          }, Math.round(740 * delayScale));
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
            : `Your turn! (AGI ${getEffectiveAgility(startRes.combatant)})`
        );
        return;
      }

      // ── PET TURN ──
      if (actorId === 'pet' && petRef.current) {
        setTurn('animating');
        const activePet = petRef.current;
        const aliveTargetIdx = curEnemies.findIndex((e) => e.hp > 0);
        if (aliveTargetIdx === -1) {
          armSequenceCallbacks(null, () => concludeBattle(true));
          stageRef.current?.playSequence('player_win');
          return;
        }
        setCombatLog(`🐾 ${activePet.name}'s turn!`);
        setTimeout(() => {
          if (!mountedRef.current) return;
          gaugesRef.current['pet'] = 0;
          setTimelineGauges({ ...gaugesRef.current });
          setActiveActorId(null);

          const latestEnemies = enemiesRef.current;
          const tIdx =
            latestEnemies[aliveTargetIdx]?.hp > 0
              ? aliveTargetIdx
              : latestEnemies.findIndex((e) => e.hp > 0);
          if (tIdx === -1) return;

          const petOut = executePetTurn(activePet, latestEnemies[tIdx], tIdx, petDefRef.current);
          setPet(petOut.pet);
          const nextEnemies = latestEnemies.map((e, i) => (i === tIdx ? petOut.enemy : e));
          setEnemies(nextEnemies);
          setCombatLog(petOut.log);
          pushFloats(petOut.floats);
          if (petOut.didCrit) triggerCritShake();

          const allDeadAfterPet = nextEnemies.every((e) => e.hp <= 0);
          setTimeout(() => {
            if (!mountedRef.current) return;
            if (allDeadAfterPet) {
              armSequenceCallbacks(null, () => concludeBattle(true));
              stageRef.current?.playSequence('player_win');
            } else {
              stepTimeline(playerRef.current, nextEnemies, curCd);
            }
          }, Math.round(520 * delayScale));
        }, Math.round(480 * delayScale));
        return;
      }

      // ── RECRUITED ALLY TURN (Authentic Multi-Jutsu NPC Combat!) ──
      if (actorId.startsWith('ally_')) {
        const allyIdx = parseInt(actorId.replace('ally_', ''), 10);
        const ally = alliesRef.current[allyIdx];
        if (!ally || ally.hp <= 0) {
          gaugesRef.current[actorId] = 0;
          stepTimeline(curPlayer, curEnemies, curCd);
          return;
        }
        const aliveIndices = curEnemies
          .map((e, i) => (e.hp > 0 ? i : -1))
          .filter((i) => i !== -1);
        if (aliveIndices.length === 0) {
          armSequenceCallbacks(null, () => concludeBattle(true));
          stageRef.current?.playSequence('player_win');
          return;
        }
        const chosenTargetIdx =
          aliveIndices[Math.floor(Math.random() * aliveIndices.length)];

        setTurn('animating');
        setCombatLog(`🤝 ${ally.name}'s turn!`);

        setTimeout(() => {
          if (!mountedRef.current) return;
          gaugesRef.current[actorId] = 0;
          setTimelineGauges({ ...gaugesRef.current });
          setActiveActorId(null);

          const latestEnemies = enemiesRef.current;
          const latestAlive = latestEnemies
            .map((e, i) => (e.hp > 0 ? i : -1))
            .filter((i) => i !== -1);
          if (latestAlive.length === 0) return;
          const tIdx =
            latestEnemies[chosenTargetIdx]?.hp > 0
              ? chosenTargetIdx
              : latestAlive[Math.floor(Math.random() * latestAlive.length)];

          // Tick down this ally's jutsu cooldowns
          const prevCds = allyCooldownsRef.current[allyIdx] ?? {};
          const nextCds: Record<string, number> = {};
          for (const [k, v] of Object.entries(prevCds)) {
            if (v > 1) nextCds[k] = v - 1;
          }

          // ── RECRUITED FRIEND EQUIPPED JUTSU AI ──
          if (ally.id.startsWith('friend_')) {
            const memberSpec = battleTeam[allyIdx];
            const friendSkillIds = (memberSpec?.equippedSkills ?? ['skill_01']).slice(0, 6);
            const resolvedFriendSkills = friendSkillIds
              .map((sid) => allSkillsByIdRef.current[sid])
              .filter((s): s is SkillDef => Boolean(s));
            const readyFriendSkills = resolvedFriendSkills.filter(
              (s) => (nextCds[s.id] ?? 0) <= 0 && ally.cp >= (s.cp_cost || 0)
            );
            const chosenSkill =
              readyFriendSkills.length > 0 && Math.random() < 0.78
                ? readyFriendSkills[Math.floor(Math.random() * readyFriendSkills.length)]
                : null;

            const target = latestEnemies[tIdx];
            const didCrit = Math.random() < (ally.critChance ?? 0.12);
            const variance = 0.9 + Math.random() * 0.22;

            if (chosenSkill) {
              if (chosenSkill.cooldown > 0) nextCds[chosenSkill.id] = chosenSkill.cooldown;
              allyCooldownsRef.current[allyIdx] = nextCds;
              const nextAllyCp = Math.max(0, ally.cp - (chosenSkill.cp_cost || 0));
              const nextAlliesState = alliesRef.current.map((a, i) =>
                i === allyIdx ? { ...a, cp: nextAllyCp } : a
              );
              const skAoE = isSkillAoE(chosenSkill);
              const isSelfBuff = String(chosenSkill.target ?? '').toLowerCase() === 'self' || chosenSkill.damage === 0;
              const rawDmg = isSelfBuff
                ? 0
                : Math.max(12, Math.round((chosenSkill.damage + ally.level * 4) * variance * (didCrit ? 1.5 : 1)));
              const hitFloats: FloatingNumber[] = [];
              let nextEnemies = latestEnemies;
              let isKill = false;
              let hitLog = '';

              if (isSelfBuff) {
                const effs = skillEffectsByIdRef.current[chosenSkill.id] ?? [];
                let updatedAlly = nextAlliesState[allyIdx];
                for (const ef of effs) {
                  const res = applyNpcStatusEffect(updatedAlly, { ...ef, type: ef.type || 'Buff' });
                  updatedAlly = res.combatant;
                }
                const finalAllies = nextAlliesState.map((a, i) => (i === allyIdx ? updatedAlly : a));
                hitFloats.push({
                  id: Date.now() + Math.floor(Math.random() * 10000),
                  target: 'player',
                  text: `✨ ${chosenSkill.name}`,
                  kind: 'buff',
                });
                hitLog = `🤝 ${ally.name} cast ${chosenSkill.name}!`;
                armSequenceCallbacks(
                  () => {
                    setAllies(finalAllies);
                    setCombatLog(hitLog);
                    pushFloats(hitFloats);
                  },
                  () => {
                    stepTimeline(playerRef.current, enemiesRef.current, curCd);
                  }
                );
                stageRef.current?.playSequence(`a${allyIdx}_skill_${chosenSkill.id}_t${tIdx}`);
                return;
              }

              if (skAoE) {
                nextEnemies = latestEnemies.map((e, i) => {
                  if (e.hp <= 0) return e;
                  const nHp = Math.max(0, e.hp - rawDmg);
                  hitFloats.push({
                    id: Date.now() + i * 31 + Math.floor(Math.random() * 1000),
                    target: 'enemy',
                    targetSlot: i,
                    text: didCrit ? `CRIT -${rawDmg}!` : `-${rawDmg}`,
                    kind: didCrit ? 'crit' : 'damage',
                  });
                  return { ...e, hp: nHp };
                });
                isKill = nextEnemies[tIdx].hp <= 0;
                hitLog = `🤝 ${ally.name} cast AoE ${chosenSkill.name} for ${rawDmg} DMG!`;
              } else {
                const nextHp = Math.max(0, target.hp - rawDmg);
                isKill = nextHp <= 0;
                nextEnemies = latestEnemies.map((e, i) => (i === tIdx ? { ...e, hp: nextHp } : e));
                hitFloats.push({
                  id: Date.now() + Math.floor(Math.random() * 10000),
                  target: 'enemy',
                  targetSlot: tIdx,
                  text: didCrit ? `CRIT -${rawDmg}!` : `-${rawDmg}`,
                  kind: didCrit ? 'crit' : 'damage',
                });
                hitLog = `🤝 ${ally.name} cast ${chosenSkill.name} on ${target.name} for ${rawDmg} DMG!`;
              }

              armSequenceCallbacks(
                () => {
                  setAllies(nextAlliesState);
                  setEnemies(nextEnemies);
                  setCombatLog(hitLog);
                  pushFloats(hitFloats);
                },
                () => {
                  const allDeadAfterAlly = nextEnemies.every((e) => e.hp <= 0);
                  if (allDeadAfterAlly) {
                    armSequenceCallbacks(null, () => concludeBattle(true));
                    stageRef.current?.playSequence('player_win');
                  } else {
                    stepTimeline(playerRef.current, nextEnemies, curCd);
                  }
                }
              );
              stageRef.current?.playSequence(
                `a${allyIdx}_skill_${chosenSkill.id}_t${tIdx}${isKill ? '_kill' : ''}`
              );
              return;
            }
          }

          // Pick an authentic jutsu from npc.json (prefer off-cooldown special jutsus!)
          const npcDef = npcsByIdRef.current[ally.id];
          const atkPool = npcDef?.attacks ?? [];
          const readyAtks = atkPool.filter((a) => {
            const anim = a.animation || 'attack_01';
            return (nextCds[anim] ?? 0) <= 0;
          });
          const specialReady = readyAtks.filter((a) => (a.animation || 'attack_01') !== 'attack_01');
          const chosenAtk =
            specialReady.length > 0 && Math.random() < 0.78
              ? specialReady[Math.floor(Math.random() * specialReady.length)]
              : readyAtks[0] ?? atkPool[0];

          const atkAnim = chosenAtk?.animation || 'attack_01';
          if (chosenAtk?.cooldown && chosenAtk.cooldown > 0) {
            nextCds[atkAnim] = chosenAtk.cooldown;
          }
          allyCooldownsRef.current[allyIdx] = nextCds;

          const jutsuNum = atkAnim.replace('attack_0', '').replace('attack_', '');
          const isSupportJutsu = (chosenAtk?.dmg ?? 1) === 0;
          const isAoE = Boolean(chosenAtk?.multi_hit);
          const target = latestEnemies[tIdx];
          const didCrit = !isSupportJutsu && Math.random() < (ally.critChance ?? 0.12);
          const variance = 0.9 + Math.random() * 0.22;

          let computedDmg = 0;
          if (!isSupportJutsu) {
            const rawStat = chosenAtk?.dmg ?? ally.baseDamage;
            const scaledBase = rawStat > 0 && rawStat <= 5 ? ally.baseDamage * rawStat : rawStat;
            computedDmg = Math.max(10, Math.round(scaledBase * variance * (didCrit ? 1.5 : 1)));
          }

          let nextEnemies = latestEnemies;
          let isKill = false;
          const hitFloats: FloatingNumber[] = [];
          let hitLog = '';

          if (isSupportJutsu) {
            const effList = chosenAtk?.effects ?? [];
            let nextPlayer = playerRef.current;
            let nextAllies = alliesRef.current;
            let appliedLabels: string[] = [];

            if (effList.length === 0) {
              const healAmt = Math.max(25, Math.round(nextPlayer.maxHp * 0.15));
              nextPlayer = { ...nextPlayer, hp: Math.min(nextPlayer.maxHp, nextPlayer.hp + healAmt) };
              appliedLabels.push(`+${healAmt} HP`);
              hitFloats.push({
                id: Date.now() + Math.floor(Math.random() * 10000),
                target: 'player',
                text: `+${healAmt} HP`,
                kind: 'heal',
              });
            } else {
              for (const rawEff of effList) {
                const effTarget = String(rawEff.target || 'master').toLowerCase();
                if (effTarget === 'self') {
                  const res = applyNpcStatusEffect(ally, { ...rawEff, type: rawEff.type || 'Buff' });
                  nextAllies = nextAllies.map((a, i) => (i === allyIdx ? res.combatant : a));
                  if (res.healed) {
                    appliedLabels.push(`+${res.healed} HP`);
                    hitFloats.push({
                      id: Date.now() + Math.floor(Math.random() * 10000),
                      target: 'player',
                      text: `${ally.name} +${res.healed} HP`,
                      kind: 'heal',
                    });
                  } else if (res.applied) {
                    const amtTxt = res.applied.amount > 0 ? ` +${res.applied.amount}${res.applied.calcType === 'number' ? '' : '%'}` : '';
                    appliedLabels.push(`${res.applied.icon} ${res.applied.name}${amtTxt} (${res.applied.turns}t)`);
                    hitFloats.push({
                      id: Date.now() + Math.floor(Math.random() * 10000),
                      target: 'player',
                      text: `${res.applied.icon} ${res.applied.shortCode}${amtTxt}`,
                      kind: 'buff',
                    });
                  }
                } else if (effTarget === 'enemy') {
                  const res = applyNpcStatusEffect(target, { ...rawEff, type: 'Debuff' });
                  nextEnemies = nextEnemies.map((e, i) => (i === tIdx ? res.combatant : e));
                  if (res.applied) {
                    appliedLabels.push(`${res.applied.icon} ${res.applied.name}`);
                    hitFloats.push({
                      id: Date.now() + Math.floor(Math.random() * 10000),
                      target: 'enemy',
                      targetSlot: tIdx,
                      text: `${res.applied.icon} ${res.applied.name}`,
                      kind: 'debuff',
                    });
                  }
                } else {
                  // Default: 'master' -> buff/heal the Player!
                  const res = applyNpcStatusEffect(nextPlayer, { ...rawEff, type: rawEff.type || 'Buff' });
                  nextPlayer = res.combatant;
                  if (res.healed) {
                    appliedLabels.push(`+${res.healed} HP`);
                    hitFloats.push({
                      id: Date.now() + Math.floor(Math.random() * 10000),
                      target: 'player',
                      text: `+${res.healed} HP`,
                      kind: 'heal',
                    });
                  } else if (res.applied) {
                    const amtTxt = res.applied.amount > 0 ? ` +${res.applied.amount}${res.applied.calcType === 'number' ? '' : '%'}` : '';
                    appliedLabels.push(`${res.applied.icon} ${res.applied.name}${amtTxt} (${res.applied.turns}t)`);
                    hitFloats.push({
                      id: Date.now() + Math.floor(Math.random() * 10000),
                      target: 'player',
                      text: `${res.applied.icon} ${res.applied.name}${amtTxt}`,
                      kind: 'buff',
                    });
                  }
                }
              }
            }

            hitLog = `🤝 ${ally.name} cast Jutsu #${jutsuNum}: ${appliedLabels.join(', ') || 'Support Buff'}!`;
            armSequenceCallbacks(
              () => {
                setPlayer(nextPlayer);
                setAllies(nextAllies);
                setEnemies(nextEnemies);
                setCombatLog(hitLog);
                pushFloats(hitFloats);
              },
              () => {
                stepTimeline(nextPlayer, enemiesRef.current, curCd);
              }
            );
            stageRef.current?.playSequence(`a${allyIdx}_${atkAnim}_t${tIdx}`);
            return;
          }

          // Offensive Jutsu (single-target or AoE) + apply any authentic NPC enemy debuffs (Stun, Burn, Bleeding, etc.)!
          const enemyDebuffs = (chosenAtk?.effects ?? []).filter(
            (ef) => String(ef.target || '').toLowerCase() === 'enemy'
          );

          if (isAoE) {
            nextEnemies = latestEnemies.map((e, i) => {
              if (e.hp <= 0) return e;
              const nHp = Math.max(0, e.hp - computedDmg);
              let updated: Combatant = { ...e, hp: nHp };
              if (nHp > 0) {
                for (const defEff of enemyDebuffs) {
                  updated = applyNpcStatusEffect(updated, { ...defEff, type: 'Debuff' }).combatant;
                }
              }
              hitFloats.push({
                id: Date.now() + i * 31 + Math.floor(Math.random() * 1000),
                target: 'enemy',
                targetSlot: i,
                text: didCrit ? `CRIT -${computedDmg}!` : `-${computedDmg}`,
                kind: didCrit ? 'crit' : 'damage',
              });
              return updated;
            });
            isKill = nextEnemies[tIdx].hp <= 0;
            hitLog = `🤝 ${ally.name} cast AoE Jutsu #${jutsuNum} for ${computedDmg} DMG${didCrit ? ' (CRIT!)' : ''}!`;
          } else {
            const nextHp = Math.max(0, target.hp - computedDmg);
            isKill = nextHp <= 0;
            let updatedTarget: Combatant = { ...target, hp: nextHp };
            const debuffNames: string[] = [];
            if (nextHp > 0) {
              for (const defEff of enemyDebuffs) {
                const res = applyNpcStatusEffect(updatedTarget, { ...defEff, type: 'Debuff' });
                updatedTarget = res.combatant;
                if (res.applied) debuffNames.push(`${res.applied.icon}${res.applied.name}`);
              }
            }
            nextEnemies = latestEnemies.map((e, i) => (i === tIdx ? updatedTarget : e));
            hitFloats.push({
              id: Date.now() + Math.floor(Math.random() * 10000),
              target: 'enemy',
              targetSlot: tIdx,
              text: didCrit ? `CRIT -${computedDmg}!` : `-${computedDmg}`,
              kind: didCrit ? 'crit' : 'damage',
            });
            hitLog =
              atkAnim === 'attack_01'
                ? `🤝 ${ally.name} attacked ${target.name} for ${computedDmg} DMG${didCrit ? ' (CRIT!)' : ''}!`
                : `🤝 ${ally.name} cast Jutsu #${jutsuNum} on ${target.name} for ${computedDmg} DMG${didCrit ? ' (CRIT!)' : ''}${debuffNames.length ? ` + ${debuffNames.join(' ')}` : ''}!`;
          }

          armSequenceCallbacks(
            () => {
              setEnemies(nextEnemies);
              setCombatLog(hitLog);
              pushFloats(hitFloats);
              if (didCrit) triggerCritShake();
            },
            () => {
              const allDeadAfterAlly = nextEnemies.every((e) => e.hp <= 0);
              if (allDeadAfterAlly) {
                armSequenceCallbacks(null, () => concludeBattle(true));
                stageRef.current?.playSequence('player_win');
              } else {
                stepTimeline(playerRef.current, nextEnemies, curCd);
              }
            }
          );

          stageRef.current?.playSequence(`a${allyIdx}_${atkAnim}_t${tIdx}${isKill ? '_kill' : ''}`);
        }, Math.round(320 * delayScale));
        return;
      }

      // ── ENEMY TURN ──
      if (actorId.startsWith('ene_')) {
        const enemyIdx = parseInt(actorId.replace('ene_', ''), 10);
        const enemy = curEnemies[enemyIdx];
        if (!enemy || enemy.hp <= 0) {
          gaugesRef.current[actorId] = 0;
          stepTimeline(curPlayer, curEnemies, curCd);
          return;
        }

        setTurn('animating');
        const startRes = processTurnStart(enemy, 'enemy');
        const enemiesAfterStart = curEnemies.map((e, i) =>
          i === enemyIdx ? startRes.combatant : e
        );
        setEnemies(enemiesAfterStart);
        if (startRes.floats.length > 0) {
          pushFloats(startRes.floats.map((f) => ({ ...f, targetSlot: enemyIdx })));
        }

        if (startRes.diedFromDot) {
          setCombatLog(startRes.log ?? `${enemy.name} succumbed to status effects!`);
          const allDeadAfterDot = enemiesAfterStart.every((e) => e.hp <= 0);
          setTimeout(() => {
            if (!mountedRef.current) return;
            if (allDeadAfterDot) {
              armSequenceCallbacks(null, () => concludeBattle(true));
              stageRef.current?.playSequence('player_win');
            } else {
              gaugesRef.current[`ene_${enemyIdx}`] = 0;
              setTimelineGauges({ ...gaugesRef.current });
              setActiveActorId(null);
              stepTimeline(curPlayer, enemiesAfterStart, curCd);
            }
          }, Math.round(620 * delayScale));
          return;
        }

        if (startRes.skipTurn) {
          setCombatLog(startRes.log ?? `${enemy.name} is ${startRes.skipReason} and skips their turn!`);
          setTimeout(() => {
            if (!mountedRef.current) return;
            gaugesRef.current[`ene_${enemyIdx}`] = 0;
            setTimelineGauges({ ...gaugesRef.current });
            setActiveActorId(null);
            stepTimeline(curPlayer, enemiesAfterStart, curCd);
          }, Math.round(700 * delayScale));
          return;
        }

        setCombatLog(
          startRes.log
            ? `${startRes.log} ${enemy.name}'s turn!`
            : `${enemy.name}'s turn! (AGI ${getEffectiveAgility(startRes.combatant)})`
        );

        setTimeout(() => {
          if (!mountedRef.current) return;
          const attacker = enemiesRef.current[enemyIdx];
          const latestPlayer = playerRef.current;
          if (!attacker || attacker.hp <= 0 || latestPlayer.hp <= 0) return;

          gaugesRef.current[`ene_${enemyIdx}`] = 0;
          setTimelineGauges({ ...gaugesRef.current });
          setActiveActorId(null);

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

          armSequenceCallbacks(
            () => {
              setPlayer(enemyOut.player);
              setEnemies(enemiesAfterAtk);
              setCooldowns(enemyOut.cooldowns);
              setCombatLog(enemyOut.log);
              pushFloats(
                enemyOut.floats.map((f) =>
                  f.target === 'enemy' ? { ...f, targetSlot: enemyIdx } : f
                )
              );
              if (enemyOut.didCrit) triggerCritShake();
            },
            () => {
              if (playerKilled) {
                concludeBattle(false);
              } else if (allEnemiesDeadAfterReflect) {
                armSequenceCallbacks(null, () => concludeBattle(true));
                stageRef.current?.playSequence('player_win');
              } else {
                stepTimeline(enemyOut.player, enemiesAfterAtk, enemyOut.cooldowns);
              }
            }
          );

          stageRef.current?.playSequence(
            playerKilled ? `e_atk_s${enemyIdx}_kill` : `e_atk_s${enemyIdx}`
          );
        }, Math.round(520 * delayScale));
      }
    },
    [armSequenceCallbacks, concludeBattle, pushFloats, triggerCritShake]
  );

  const handleStageEvent = useCallback(
    (ev: StageEvent) => {
      if (ev.type === 'STAGE_READY') {
        if (turnRef.current === 'done') return;
        setStageReady(true);
        stageRef.current?.setSpeed(speedRef.current);
        const ids = equippedSkillsKey.split(',').filter(Boolean).slice(0, 8);
        if (ids.length > 0) {
          const iconsUrl = buildSkillIconsSwfUrl(serverUrl, ids.join(','));
          stageRef.current?.captureSkillIcons(iconsUrl, ids);
        }
        // Also capture authentic HD SWF icons for the character's REAL owned Battle Consumables!
        const ownedSwfIds = Object.entries(profile?.ownedItems ?? {})
          .filter(([id, qty]) => qty > 0 && id !== 'item_01')
          .map(([id]) => id)
          .slice(0, 12);
        if (ownedSwfIds.length > 0) {
          const itemIconsUrl = buildIconSheetSwfUrl(serverUrl, 'consumables', ownedSwfIds.join(','));
          stageRef.current?.captureSkillIcons(itemIconsUrl, ownedSwfIds);
        }
        setCombatLog(
          `${activeBattle?.mission.name ?? 'Battle'} — ${initialEnemies.length} enemy`
        );
        setTimeout(() => {
          stepTimeline(playerRef.current, enemiesRef.current, cooldownsRef.current);
        }, 220);
        return;
      }
      if (ev.type === 'SKILL_ICONS') {
        setSkillIcons((prev) => ({ ...prev, ...ev.icons }));
        return;
      }
      if (ev.type === 'ANIM_HIT') {
        pendingHitRef.current?.();
        return;
      }
      if (ev.type === 'ANIM_DONE') {
        pendingDoneRef.current?.();
        return;
      }
    },
    [activeBattle?.mission.name, equippedSkillsKey, initialEnemies.length, serverUrl, stepTimeline]
  );

  const handlePlayerMove = useCallback(
    (action: { type: 'attack' } | { type: 'charge' } | { type: 'skill'; skill: SkillDef }) => {
      if (turn !== 'player' || !stageReady) return;
      playClickSfx(serverUrl);
      setShowItems(false);
      setInspectedSkill(null);

      const curEnemies = enemiesRef.current;
      const activeTargetIdx =
        curEnemies[targetIdx] && curEnemies[targetIdx].hp > 0
          ? targetIdx
          : curEnemies.findIndex((e) => e.hp > 0);
      if (activeTargetIdx === -1) return;

      const skEffects =
        action.type === 'skill' ? skillEffectsByIdRef.current[action.skill.id] : undefined;
      const outcome = executePlayerActionMulti(
        playerRef.current,
        curEnemies,
        activeTargetIdx,
        cooldownsRef.current,
        action,
        skEffects
      );

      if (action.type === 'skill' && outcome.log.startsWith('Not enough CP')) {
        setCombatLog(outcome.log);
        return;
      }

      setCooldowns(outcome.cooldowns);
      setTurn('animating');

      gaugesRef.current['player'] = 0;
      setTimelineGauges({ ...gaugesRef.current });
      setActiveActorId(null);

      const updatedEnemies = outcome.enemies;
      const targetKilled = updatedEnemies[activeTargetIdx].hp <= 0;
      const aliveSlotsAfter = updatedEnemies
        .map((e, i) => (e.hp > 0 ? i : -1))
        .filter((i) => i !== -1);
      const allEnemiesDead = aliveSlotsAfter.length === 0;
      const playerDiedFromReflect = outcome.player.hp <= 0;

      if (action.type === 'skill') {
        setPlayer(outcome.player);
        setCombatLog(
          `${playerRef.current.name} casts ${outcome.isAoE ? 'AoE ' : ''}${action.skill.name}!`
        );
      }

      armSequenceCallbacks(
        () => {
          setPlayer(outcome.player);
          setEnemies(updatedEnemies);
          setCombatLog(outcome.log);
          pushFloats(outcome.floats);
          if (outcome.didCrit) triggerCritShake();
          if (targetKilled && !allEnemiesDead) {
            setTargetIdx(aliveSlotsAfter[0]);
          }
        },
        () => {
          if (playerDiedFromReflect) {
            concludeBattle(false);
          } else if (allEnemiesDead) {
            armSequenceCallbacks(null, () => concludeBattle(true));
            stageRef.current?.playSequence('player_win');
          } else {
            stepTimeline(outcome.player, updatedEnemies, outcome.cooldowns);
          }
        }
      );

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
    },
    [armSequenceCallbacks, concludeBattle, pushFloats, serverUrl, stageReady, stepTimeline, targetIdx, triggerCritShake, turn]
  );

  const handleUseConsumable = (item: BattleConsumableTile) => {
    if (turn !== 'player' || !stageReady || item.qty <= 0) return;
    playClickSfx(serverUrl);
    setShowItems(false);

    const curP = playerRef.current;
    const nextCds: Record<string, number> = {};
    for (const [k, v] of Object.entries(cooldownsRef.current)) {
      if (v > 1) nextCds[k] = v - 1;
    }

    let nextPlayer: Combatant = { ...curP };
    const itemFloats: FloatingNumber[] = [];
    let itemLog = '';

    if (item.effectKind === 'hp') {
      const healAmt = item.restoreAmount > 0 ? item.restoreAmount : Math.max(45, Math.round(curP.maxHp * 0.35));
      nextPlayer = { ...curP, hp: Math.min(curP.maxHp, curP.hp + healAmt) };
      itemFloats.push({ id: Date.now(), target: 'player', text: `+${healAmt} HP`, kind: 'heal' });
      itemLog = `${curP.name} used ${item.name} (+${healAmt} HP)!`;
    } else if (item.effectKind === 'cp') {
      const cpAmt = item.restoreAmount > 0 ? item.restoreAmount : Math.max(45, Math.round(curP.maxCp * 0.35));
      nextPlayer = { ...curP, cp: Math.min(curP.maxCp, curP.cp + cpAmt) };
      itemFloats.push({ id: Date.now(), target: 'player', text: `+${cpAmt} CP`, kind: 'cp' });
      itemLog = `${curP.name} used ${item.name} (+${cpAmt} CP)!`;
    } else {
      nextPlayer = { ...curP, statuses: (curP.statuses ?? []).filter((s) => s.type !== 'Debuff') };
      itemFloats.push({ id: Date.now(), target: 'player', text: 'PURIFIED!', kind: 'buff' });
      itemLog = `${curP.name} used ${item.name} (Debuffs cleared)!`;
    }

    usedItemsRef.current[item.id] = (usedItemsRef.current[item.id] ?? 0) + 1;
    setConsumables((prev) =>
      prev
        .map((c) => (c.id === item.id ? { ...c, qty: Math.max(0, c.qty - 1) } : c))
        .filter((c) => c.qty > 0)
    );
    setCooldowns(nextCds);
    setTurn('animating');

    gaugesRef.current['player'] = 0;
    setTimelineGauges({ ...gaugesRef.current });
    setActiveActorId(null);

    armSequenceCallbacks(
      () => {
        setPlayer(nextPlayer);
        setCombatLog(itemLog);
        pushFloats(itemFloats);
      },
      () => {
        stepTimeline(nextPlayer, enemiesRef.current, nextCds);
      }
    );
    stageRef.current?.playSequence('player_item');
  };

  // Auto-Battle Hook
  useEffect(() => {
    if (!autoBattle || turn !== 'player' || !stageReady || showFleeModal || inspectedUnit || inspectedSkill) return;
    const delay = speed > 1 ? 280 : 420;
    const timer = setTimeout(() => {
      if (!mountedRef.current || !autoRef.current) return;
      const chosen = chooseAutoBattleAction(
        playerRef.current,
        enemiesRef.current,
        skills,
        cooldownsRef.current,
        skillEffectsByIdRef.current
      );
      handlePlayerMove(chosen);
    }, delay);
    return () => clearTimeout(timer);
  }, [autoBattle, turn, stageReady, showFleeModal, inspectedUnit, inspectedSkill, speed, skills, handlePlayerMove]);

  const handleAttemptFlee = () => {
    playClickSfx(serverUrl);
    setShowFleeModal(false);
    if (turn !== 'player') return;
    const res = attemptFlee(playerRef.current, enemiesRef.current);
    setCombatLog(res.log);
    if (res.escaped) {
      setAutoBattle(false);
      clearTeam();
      setTimeout(() => {
        setActiveBattle(null);
        navigate('missions');
      }, 450);
    } else {
      setTurn('animating');
      gaugesRef.current['player'] = 0;
      setTimelineGauges({ ...gaugesRef.current });
      setActiveActorId(null);
      pushFloats([{ id: Date.now(), target: 'player', text: 'FLEE FAILED!', kind: 'debuff' }]);
      setTimeout(() => {
        stepTimeline(playerRef.current, enemiesRef.current, cooldownsRef.current);
      }, 650);
    }
  };

  const handleExit = () => {
    playClickSfx(serverUrl);
    clearWatchdogs();
    clearTeam();
    setShowFleeModal(false);
    setAutoBattle(false);
    const usedSnapshot = { ...usedItemsRef.current };
    if (turnRef.current !== 'done' && Object.keys(usedSnapshot).length > 0 && profile && sessionKey && activeBattle) {
      usedItemsRef.current = {};
      api
        .battleFinish(profile.charId, sessionKey, activeBattle.mission.id, activeBattle.token, false, usedSnapshot)
        .then(() => api.getCharacter(profile.charId, sessionKey))
        .then((raw) => useAuthStore.getState().setProfileFromRaw(profile.charId, raw))
        .catch(() => {});
    }
    const isExamBattle = Boolean(activeBattle?.examContext);
    setActiveBattle(null);
    navigate(isExamBattle ? 'headquarter' : 'missions');
  };

  const hpPct = (c: Combatant) => `${Math.max(0, Math.round((c.hp / Math.max(1, c.maxHp)) * 100))}%`;
  const cpPct = (c: Combatant) => `${Math.max(0, Math.round((c.cp / Math.max(1, c.maxCp)) * 100))}%`;

  const playerFloats = floats.filter((f) => f.target === 'player');
  const enemyFloats = floats.filter((f) => f.target === 'enemy');
  const allDead = enemies.every((e) => e.hp <= 0);
  const skillsSealed = isSkillsRestricted(player);
  const chargeLocked = isChargeDisabled(player);
  const totalConsumablesLeft = consumables.reduce((sum, c) => sum + c.qty, 0);

  const renderStatusBadges = (statuses?: StatusEffect[]) => {
    if (!statuses || statuses.length === 0) return null;
    return (
      <View style={styles.statusRow}>
        {statuses.slice(0, 4).map((st) => (
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

  const playerPt = swfToScreen(SWF_PLAYER_X, SWF_PLAYER_Y, stageSize.width, stageSize.height);
  const enemyFormation =
    SWF_ENEMY_FORMATIONS[Math.min(3, Math.max(1, enemies.length))] ?? SWF_ENEMY_FORMATIONS[1];

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) {
          setStageSize((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height }
          );
        }
      }}
    >
      {/* 1) FULL-SCREEN 1 LAYAR 36 FPS BATTLE STAGE (Stationary Native GPU Hardware Layer — zero WebView shake stutter!) */}
      <View style={styles.fullStage}>
        <RuffleStageView
          ref={stageRef}
          baseUrl={serverUrl}
          onEvent={handleStageEvent}
        />
      </View>

      <LoadingScreenOverlay visible={!stageReady} />

      {/* 2) TOP OVERLAY: Mission Info (Left) + Ninja Horizon Agility Rail (Center) + Speed/Auto (Right) */}
      <View style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.missionChip}>
          <Text style={styles.missionTitle} numberOfLines={1}>
            {activeBattle?.mission.name ?? 'Battle'}
          </Text>
          <View style={styles.missionSubRow}>
            <Text style={styles.roundBadge}>TURN {Math.max(1, turnCount)}</Text>
            <Text style={[styles.turnStateText, turn === 'player' && styles.turnStatePlayer]}>
              {!stageReady ? 'LOADING...' : turn === 'player' ? 'YOUR TURN' : 'ACTION'}
            </Text>
          </View>
        </View>

        {/* Ninja Horizon Top-Center Golden Agility Rail (60 FPS Native GPU) */}
        <View style={styles.atbRailOuter}>
          <View
            style={styles.atbTrack}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              if (w > 40) setAtbTrackWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
            }}
          >
            <View style={[styles.atbTick, { left: '25%' }]} />
            <View style={[styles.atbTick, { left: '50%' }]} />
            <View style={[styles.atbTick, { left: '75%' }]} />
            <View style={styles.atbRailGlow} />

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
                trackWidth={atbTrackWidth}
              />
            )}

            {pet && (
              <TimelineToken
                id="pet"
                name="PET"
                agility={getEffectiveAgility(pet)}
                gauge={timelineGauges['pet'] ?? 0}
                isActive={activeActorId === 'pet'}
                isPlayer={true}
                isPet={true}
                emoji="🐾"
                turnKey={turnCount}
                trackWidth={atbTrackWidth}
              />
            )}

            {allies.map((al, idx) => {
              if (al.hp <= 0) return null;
              return (
                <TimelineToken
                  key={`atb-ally-${al.id}-${idx}`}
                  id={`ally_${idx}`}
                  name={al.name.slice(0, 4).toUpperCase()}
                  agility={getEffectiveAgility(al)}
                  gauge={timelineGauges[`ally_${idx}`] ?? 0}
                  isActive={activeActorId === `ally_${idx}`}
                  isPlayer={true}
                  emoji="🤝"
                  turnKey={turnCount}
                  trackWidth={atbTrackWidth}
                />
              );
            })}

            {enemies.map((en, idx) => {
              if (en.hp <= 0) return null;
              return (
                <TimelineToken
                  key={`atb-en-${en.id}-${idx}`}
                  id={`ene_${idx}`}
                  name={enemies.length > 1 ? `E${idx + 1}` : 'FOE'}
                  agility={getEffectiveAgility(en)}
                  gauge={timelineGauges[`ene_${idx}`] ?? 0}
                  isActive={activeActorId === `ene_${idx}`}
                  isPlayer={false}
                  emoji="👺"
                  turnKey={turnCount}
                  trackWidth={atbTrackWidth}
                />
              );
            })}
          </View>

          <View style={styles.atbActCap}>
            <Text style={styles.atbActText}>⚡ACT</Text>
          </View>
        </View>

        {/* AUTO Control */}
        <View style={styles.topRightControls}>
          <Pressable
            style={[styles.ctrlPill, autoBattle && styles.ctrlAutoActive]}
            onPress={toggleAuto}
          >
            <Text style={[styles.ctrlPillText, autoBattle && styles.ctrlPillTextActive]}>
              {autoBattle ? 'AUTO ON' : 'AUTO'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* 3) PIXEL-ALIGNED HP & CP BARS BEHIND EACH CHARACTER (Symmetrical: Left of Player, Right of Enemies!) */}
      <View style={styles.unitPlatesLayer} pointerEvents="box-none" renderToHardwareTextureAndroid>
        {/* Player HP & CP Plate — directly behind Player (to the left) & vertically centered on torso; hold to inspect */}
        <Pressable
          delayLongPress={260}
          onLongPress={() => {
            playClickSfx(serverUrl);
            setInspectedUnit({ side: 'player', idx: 0 });
          }}
          style={[
            styles.unitPlate,
            styles.playerPlateBorder,
            {
              left: Math.max(8, playerPt.x - 40 * playerPt.scale - UNIT_PLATE_W),
              top: playerPt.y - SWF_CHAR_CENTER_Y_OFFSET * playerPt.scale - UNIT_PLATE_H / 2,
            },
          ]}
        >
          <View style={styles.plateNameRow}>
            <Text style={styles.plateName} numberOfLines={1}>
              {player.name}
            </Text>
            <Text style={styles.plateLv}>Lv.{player.level}</Text>
          </View>
          <View style={styles.unitBarBg}>
            <View style={[styles.unitHpFill, { width: hpPct(player) as `${number}%` }]} />
            <Text style={styles.unitBarText}>
              HP {player.hp}/{player.maxHp}
            </Text>
          </View>
          <View style={styles.unitBarBg}>
            <View style={[styles.unitCpFill, { width: cpPct(player) as `${number}%` }]} />
            <Text style={styles.unitBarText}>
              CP {player.cp}/{player.maxCp}
            </Text>
          </View>
        </Pressable>

        {/* Recruited Ally HP & CP Plates — directly behind each Ally (to the left); hold to inspect */}
        {allies.map((al, idx) => {
          const [axSwf, aySwf] = SWF_ALLY_POS[idx] ?? SWF_ALLY_POS[0];
          const aPt = swfToScreen(axSwf, aySwf, stageSize.width, stageSize.height);
          const dead = al.hp <= 0;
          return (
            <Pressable
              key={`plate-ally-${al.id}-${idx}`}
              delayLongPress={260}
              onLongPress={() => {
                playClickSfx(serverUrl);
                setInspectedUnit({ side: 'ally', idx });
              }}
              style={[
                styles.unitPlate,
                styles.allyPlateBorder,
                {
                  left: Math.max(8, aPt.x - 40 * aPt.scale - UNIT_PLATE_W),
                  top: aPt.y - SWF_CHAR_CENTER_Y_OFFSET * aPt.scale - UNIT_PLATE_H / 2,
                },
                dead && styles.enemyPlateDead,
              ]}
            >
              <View style={styles.plateNameRow}>
                <Text style={styles.plateName} numberOfLines={1}>
                  {al.name}
                </Text>
                <Text style={styles.plateLv}>Lv.{al.level}</Text>
              </View>
              <View style={styles.unitBarBg}>
                <View style={[styles.unitHpFill, { width: hpPct(al) as `${number}%` }]} />
                <Text style={styles.unitBarText}>
                  {dead ? 'KO' : `HP ${al.hp}/${al.maxHp}`}
                </Text>
              </View>
              <View style={styles.unitBarBg}>
                <View style={[styles.unitCpFill, { width: cpPct(al) as `${number}%` }]} />
                <Text style={styles.unitBarText}>
                  {dead ? '-' : `CP ${al.cp}/${al.maxCp}`}
                </Text>
              </View>
            </Pressable>
          );
        })}

        {/* Enemy HP & CP Plates — directly behind each Enemy (to the right) & vertically aligned */}
        {enemies.map((en, idx) => {
          const dead = en.hp <= 0;
          const selected = idx === targetIdx && !dead;
          const [exSwf, eySwf] = enemyFormation[idx] ?? enemyFormation[0];
          const ePt = swfToScreen(exSwf, eySwf, stageSize.width, stageSize.height);
          const plateLeft = Math.min(
            stageSize.width - UNIT_PLATE_W - 8,
            ePt.x + 40 * ePt.scale
          );
          const plateTop =
            ePt.y - SWF_CHAR_CENTER_Y_OFFSET * ePt.scale - UNIT_PLATE_H / 2;

          return (
            <Pressable
              key={`plate-${en.id}-${idx}`}
              delayLongPress={260}
              style={[
                styles.unitPlate,
                styles.enemyPlateBorder,
                { left: plateLeft, top: plateTop },
                selected && styles.enemyPlateSelected,
                dead && styles.enemyPlateDead,
              ]}
              onPress={() => !dead && setTargetIdx(idx)}
              onLongPress={() => {
                playClickSfx(serverUrl);
                setInspectedUnit({ side: 'enemy', idx });
              }}
            >
              {selected && (
                <View style={styles.targetPin}>
                  <Text style={styles.targetPinText}>🎯</Text>
                </View>
              )}
              <View style={styles.plateNameRow}>
                <Text style={styles.plateName} numberOfLines={1}>
                  {en.name}
                </Text>
                <Text style={styles.plateLv}>Lv.{en.level}</Text>
              </View>
              <View style={styles.unitBarBg}>
                <View style={[styles.unitEnemyHpFill, { width: hpPct(en) as `${number}%` }]} />
                <Text style={styles.unitBarText}>
                  {dead ? 'KO' : `HP ${en.hp}/${en.maxHp}`}
                </Text>
              </View>
              <View style={styles.unitBarBg}>
                <View style={[styles.unitCpFill, { width: cpPct(en) as `${number}%` }]} />
                <Text style={styles.unitBarText}>
                  {dead ? '-' : `CP ${en.cp}/${en.maxCp}`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* 4) ANIMATED FLOATING COMBAT POPUPS */}
      <View pointerEvents="none" style={styles.leftFloatZone}>
        {playerFloats.map((f, idx) => (
          <FloatingPopup
            key={f.id}
            item={f}
            index={idx}
            speedMultiplier={speed}
            onDone={removeFloat}
          />
        ))}
      </View>

      <View pointerEvents="none" style={styles.rightFloatZone}>
        {enemyFloats.map((f, idx) => (
          <FloatingPopup
            key={f.id}
            item={f}
            index={idx}
            speedMultiplier={speed}
            onDone={removeFloat}
          />
        ))}
      </View>

      {/* 6) BATTLE CONSUMABLES POPOVER (Authentic SWF Icons in Jutsu-Style Tiles with Top-Right Level Badge!) */}
      {showItems && (
        <View style={styles.itemsDrawer}>
          {consumables.map((item) => {
            const iconUri = skillIcons[item.swfId];
            const disabled = item.qty <= 0 || turn !== 'player';
            return (
              <Pressable
                key={item.id}
                style={[
                  styles.itemJutsuTile,
                  { backgroundColor: item.bgColor, borderColor: item.borderColor },
                  disabled && styles.disabledBtn,
                ]}
                disabled={disabled}
                onPress={() => handleUseConsumable(item)}
              >
                {iconUri ? (
                  <Image source={{ uri: iconUri }} style={styles.itemTileIcon} resizeMode="cover" />
                ) : (
                  <Text style={styles.itemIcon}>{item.icon}</Text>
                )}
                {/* Level badge at top-right corner of the border */}
                <View style={styles.itemLvBadge}>
                  <Text style={styles.itemLvText}>Lv.{item.level}</Text>
                </View>
                {/* Quantity badge at bottom-right */}
                <View style={styles.itemQtyBadge}>
                  <Text style={styles.itemQtyText}>x{item.qty}</Text>
                </View>
              </Pressable>
            );
          })}
          <Pressable style={styles.itemCloseBtn} onPress={() => setShowItems(false)}>
            <Text style={styles.itemCloseTxt}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* 7) NINJA HORIZON FLOATING BOTTOM ACTION DOCK (Attack, Charge, Elemental Jutsu, Item, Flee) */}
      <View style={styles.bottomDockWrap} pointerEvents="box-none" renderToHardwareTextureAndroid>
        <View style={styles.bottomDock}>
          <AttackActionTile
            disabled={turn !== 'player' || !stageReady}
            onPress={() => handlePlayerMove({ type: 'attack' })}
          />

          <ChargeActionTile
            disabled={turn !== 'player' || !stageReady || chargeLocked}
            locked={chargeLocked}
            onPress={() => handlePlayerMove({ type: 'charge' })}
          />

          <View style={styles.dockDivider} />

          {skills.slice(0, 8).map((sk) => {
            const cd = cooldowns[sk.id] ?? 0;
            const effCpCost = getEffectiveSkillCpCost(player, sk.cp_cost || 0);
            const noCp = player.cp < effCpCost;
            const disabled = turn !== 'player' || !stageReady || cd > 0 || noCp || skillsSealed;
            return (
              <JutsuActionTile
                key={sk.id}
                skill={sk}
                iconUri={skillIcons[sk.id]}
                cpCost={effCpCost}
                cooldown={cd}
                disabled={disabled}
                sealed={skillsSealed}
                onPress={() => handlePlayerMove({ type: 'skill', skill: sk })}
                onLongPress={() => {
                  playClickSfx(serverUrl);
                  setInspectedSkill(sk);
                }}
              />
            );
          })}

          <View style={styles.dockDivider} />

          <ItemActionTile
            count={totalConsumablesLeft}
            active={showItems}
            disabled={turn !== 'player' || !stageReady || totalConsumablesLeft <= 0}
            onPress={() => {
              playClickSfx(serverUrl);
              setShowItems((v) => !v);
            }}
          />

          <FleeActionTile
            onPress={() => {
              playClickSfx(serverUrl);
              setShowFleeModal(true);
            }}
          />
        </View>
      </View>

      {/* Combatant Long-Press Inspector (Stats, Buffs & Debuffs — Ninja Horizon style) */}
      {inspectedUnit && (() => {
        const unit =
          inspectedUnit.side === 'player'
            ? player
            : inspectedUnit.side === 'ally'
            ? allies[inspectedUnit.idx]
            : enemies[inspectedUnit.idx];
        if (!unit) return null;
        const isFriendly = inspectedUnit.side === 'player' || inspectedUnit.side === 'ally';
        const sideLabel =
          inspectedUnit.side === 'player' ? 'NINJA' : inspectedUnit.side === 'ally' ? 'ALLY' : 'ENEMY';
        const sideTagStyle =
          inspectedUnit.side === 'player'
            ? styles.inspectTagPlayer
            : inspectedUnit.side === 'ally'
            ? styles.inspectTagAlly
            : styles.inspectTagEnemy;
        const effAgi = getEffectiveAgility(unit);
        const baseDmg = unit.weaponDamage ?? unit.baseDamage;
        const dmgMult = getOutgoingDamageMultiplier(unit);
        const effDmg = Math.max(1, Math.round(baseDmg * dmgMult));
        const baseCrit = unit.critChance ?? 0.05;
        const effCrit = getEffectiveCritChance(unit);
        const baseDodge = unit.dodgeChance ?? 0.05;
        const effDodge = getEffectiveUnitDodgeChance(unit);
        const baseAcc = unit.accuracyChance ?? 0;
        const effAcc = getEffectiveUnitAccuracyChance(unit);

        const buffs = (unit.statuses ?? []).filter((s) => s.turns > 0 && s.type === 'Buff');
        const debuffs = (unit.statuses ?? []).filter((s) => s.turns > 0 && s.type === 'Debuff');
        const pct = (v?: number) => `${Math.round((v ?? 0) * 1000) / 10}%`;
        const deltaColor = (eff: number, base: number) =>
          eff > base + 0.0001 ? '#4ADE80' : eff < base - 0.0001 ? '#F87171' : '#F8FAFC';
        const fmtPctDelta = (eff: number, base: number) => {
          const d = Math.round((eff - base) * 1000) / 10;
          if (Math.abs(d) < 0.1) return pct(eff);
          return `${pct(eff)} (${d > 0 ? '+' : ''}${d}%)`;
        };

        return (
          <Pressable style={styles.tooltipOverlay} onPress={() => setInspectedUnit(null)}>
            <Pressable style={styles.inspectCard} onPress={() => {}}>
              <View style={styles.inspectHead}>
                <View style={styles.inspectTitleWrap}>
                  <View style={[styles.inspectSideTag, sideTagStyle]}>
                    <Text style={styles.inspectSideText}>{sideLabel}</Text>
                  </View>
                  <Text style={styles.inspectName} numberOfLines={1}>
                    {unit.name}
                  </Text>
                  <Text style={styles.inspectLv}>Lv.{unit.level}</Text>
                </View>
                <Pressable style={styles.inspectCloseBtn} onPress={() => setInspectedUnit(null)}>
                  <Text style={styles.inspectCloseTxt}>✕</Text>
                </Pressable>
              </View>

              {/* HP & CP Bars */}
              <View style={styles.inspectBarsRow}>
                <View style={styles.inspectBarWrap}>
                  <View style={[styles.unitHpFill, !isFriendly && styles.unitEnemyHpFill, { width: hpPct(unit) as `${number}%` }]} />
                  <Text style={styles.inspectBarTxt}>HP {unit.hp} / {unit.maxHp}</Text>
                </View>
                <View style={styles.inspectBarWrap}>
                  <View style={[styles.unitCpFill, { width: cpPct(unit) as `${number}%` }]} />
                  <Text style={styles.inspectBarTxt}>CP {unit.cp} / {unit.maxCp}</Text>
                </View>
              </View>

              {/* Combat Stats Grid (Live Buffed / Debuffed Effective Values!) */}
              <View style={styles.inspectStatsGrid}>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>⚡ Agility</Text>
                  <Text style={[styles.inspectStatVal, { color: deltaColor(effAgi, unit.agility) }]}>
                    {effAgi}
                    {effAgi !== unit.agility ? ` (${effAgi > unit.agility ? '+' : ''}${effAgi - unit.agility})` : ''}
                  </Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>⚔️ Base DMG</Text>
                  <Text style={[styles.inspectStatVal, { color: deltaColor(effDmg, baseDmg) }]}>
                    {effDmg}
                    {Math.abs(dmgMult - 1) >= 0.01 ? ` (${dmgMult > 1 ? '+' : ''}${Math.round((dmgMult - 1) * 100)}%)` : ''}
                  </Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>🎯 Critical</Text>
                  <Text style={[styles.inspectStatVal, { color: deltaColor(effCrit, baseCrit) }]}>
                    {fmtPctDelta(effCrit, baseCrit)}
                  </Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>💨 Dodge</Text>
                  <Text style={[styles.inspectStatVal, { color: deltaColor(effDodge, baseDodge) }]}>
                    {fmtPctDelta(effDodge, baseDodge)}
                  </Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>🔍 Accuracy</Text>
                  <Text style={[styles.inspectStatVal, { color: deltaColor(effAcc, baseAcc) }]}>
                    {fmtPctDelta(effAcc, baseAcc)}
                  </Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>✨ Purify</Text>
                  <Text style={styles.inspectStatVal}>{pct(unit.purifyChance)}</Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>🛡️ Reactive</Text>
                  <Text style={styles.inspectStatVal}>{pct(unit.reactiveChance)}</Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>🔥 Combust</Text>
                  <Text style={styles.inspectStatVal}>{pct(unit.combustionChance)}</Text>
                </View>
              </View>

              {/* Active Buffs & Debuffs */}
              <View style={styles.inspectStatusSection}>
                <Text style={styles.inspectSectionTitle}>
                  ACTIVE BUFFS ({buffs.length}) & DEBUFFS ({debuffs.length})
                </Text>
                {buffs.length === 0 && debuffs.length === 0 ? (
                  <Text style={styles.inspectEmptyText}>No active buffs or debuffs.</Text>
                ) : (
                  <View style={styles.inspectStatusList}>
                    {[...buffs, ...debuffs].map((st) => (
                      <View
                        key={`insp-${st.id}`}
                        style={[
                          styles.inspectStatusRow,
                          st.type === 'Buff' ? styles.inspectRowBuff : styles.inspectRowDebuff,
                        ]}
                      >
                        <Text style={styles.inspectStatusName}>
                          {st.icon} {st.name}
                          {st.amount > 0
                            ? ` (${st.amount}${st.calcType === 'number' ? '' : '%'})`
                            : ''}
                        </Text>
                        <Text style={styles.inspectStatusTurns}>
                          {st.turns}t
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </Pressable>
          </Pressable>
        );
      })()}

      {/* Skill Long-Press Inspector (Ninja Horizon style: real icon, stats, target, description & parsed effects!) */}
      {inspectedSkill && (() => {
        const elem = getSkillElementMeta(inspectedSkill.type);
        const effCp = getEffectiveSkillCpCost(player, inspectedSkill.cp_cost || 0);
        const skEffs = (skillEffectsByIdRef.current[inspectedSkill.id] ?? []).filter(
          (e) => e && e.effect && !e.passive
        );
        const targetLabel = isSkillAoE(inspectedSkill)
          ? 'ALL ENEMIES'
          : String(inspectedSkill.target ?? 'Single').toUpperCase();

        return (
          <Pressable style={styles.tooltipOverlay} onPress={() => setInspectedSkill(null)}>
            <Pressable style={styles.inspectCard} onPress={() => {}}>
              <View style={styles.inspectHead}>
                <View style={styles.inspectTitleWrap}>
                  {skillIcons[inspectedSkill.id] ? (
                    <Image
                      source={{ uri: skillIcons[inspectedSkill.id] }}
                      style={styles.inspectSkillIcon}
                      resizeMode="contain"
                    />
                  ) : (
                    <Text style={{ fontSize: 18 }}>{elem.icon}</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inspectName} numberOfLines={1}>
                      {inspectedSkill.name}
                    </Text>
                    <Text style={styles.tooltipElem}>
                      {elem.icon} {elem.label} • {targetLabel}
                    </Text>
                  </View>
                </View>
                <Pressable style={styles.inspectCloseBtn} onPress={() => setInspectedSkill(null)}>
                  <Text style={styles.inspectCloseTxt}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.inspectStatsGrid}>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>⚔️ Damage</Text>
                  <Text style={styles.inspectStatVal}>{inspectedSkill.damage}</Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>💧 CP Cost</Text>
                  <Text style={styles.inspectStatVal}>{effCp}</Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>⏳ Cooldown</Text>
                  <Text style={styles.inspectStatVal}>{inspectedSkill.cooldown}t</Text>
                </View>
                <View style={styles.inspectStatBox}>
                  <Text style={styles.inspectStatLabel}>⭐ Req Lv</Text>
                  <Text style={styles.inspectStatVal}>Lv.{inspectedSkill.level}</Text>
                </View>
              </View>

              <Text style={styles.tooltipDesc}>
                {inspectedSkill.description || 'Ninjutsu technique.'}
              </Text>

              {skEffs.length > 0 && (
                <View style={styles.inspectStatusSection}>
                  <Text style={styles.inspectSectionTitle}>JUTSU EFFECTS</Text>
                  <View style={styles.inspectStatusList}>
                    {skEffs.map((ef, i) => {
                      const isBuff = ef.type === 'Buff' || ef.target === 'self';
                      return (
                        <View
                          key={`skeff-${i}`}
                          style={[
                            styles.inspectStatusRow,
                            isBuff ? styles.inspectRowBuff : styles.inspectRowDebuff,
                          ]}
                        >
                          <Text style={styles.inspectStatusName}>
                            {ef.effect_name || ef.effect.replace(/_/g, ' ')}
                            {ef.amount ? ` ${ef.amount}${ef.calc_type === 'number' ? '' : '%'}` : ''}
                            {ef.chance && ef.chance < 100 ? ` (${ef.chance}%)` : ''}
                          </Text>
                          {ef.duration ? (
                            <Text style={styles.inspectStatusTurns}>{ef.duration}t</Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </Pressable>
          </Pressable>
        );
      })()}

      {/* Flee / Retreat Confirmation Modal (100% Retreat via Forfeit) */}
      {showFleeModal && (
        <View style={styles.resultOverlay}>
          <View style={styles.fleeCard}>
            <Text style={styles.fleeTitle}>Retreat from Battle?</Text>
            <Text style={styles.fleeSub}>
              Forfeit and retreat immediately from this battle?
            </Text>
            <View style={styles.fleeBtnRow}>
              <Pressable style={[styles.fleeModalBtn, styles.fleeQuitBtn]} onPress={handleExit}>
                <Text style={styles.doneBtnText}>Forfeit</Text>
              </Pressable>
              <Pressable
                style={[styles.fleeModalBtn, styles.fleeCancelBtn]}
                onPress={() => setShowFleeModal(false)}
              >
                <Text style={styles.doneBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Victory / Defeat Result Overlay */}
      {turn === 'done' && (finishResult || finishing) && (
        <View style={styles.resultOverlay}>
          <View style={styles.resultCard}>
            <Text style={[styles.resultTitle, !allDead && styles.resultTitleDefeat]}>
              {allDead ? 'VICTORY!' : 'DEFEAT'}
            </Text>
            {finishing || !finishResult ? (
              <ActivityIndicator color="#F59E0B" style={{ marginVertical: 12 }} />
            ) : (
              <View style={styles.resultBody}>
                {activeBattle?.examContext ? (
                  <>
                    <Text style={styles.premBonusTxt}>
                      {allDead
                        ? `🏆 ${activeBattle.examContext.stageTitle} CLEARED!`
                        : `Exam Stage Failed — Train & try again!`}
                    </Text>
                    <Text style={styles.rewardSub}>
                      {activeBattle.examContext.examLabel}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.rewardLine}>
                      +{finishResult.xp_reward} XP  •  +{finishResult.gold_reward} Gold
                    </Text>
                    {finishResult.premium_bonus && (
                      <Text style={styles.premBonusTxt}>★ Premium User +50% Bonus Active!</Text>
                    )}
                    <Text style={styles.rewardSub}>
                      Current: Lv.{finishResult.level} | Total Gold: {finishResult.gold}
                    </Text>
                    {finishResult.level_up && (
                      <Text style={styles.levelUp}>LEVEL UP! (+1 Attribute Point)</Text>
                    )}
                    {finishResult.level_capped && finishResult.cap_exam && (
                      <Text style={styles.premBonusTxt}>
                        🔒 Level Cap — Clear {finishResult.cap_exam} at Headquarter to level up!
                      </Text>
                    )}
                  </>
                )}
              </View>
            )}
            <Pressable style={styles.doneBtn} onPress={handleExit}>
              <Text style={styles.doneBtnText}>
                {activeBattle?.examContext ? 'Back to Headquarter' : 'Back to Missions'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
    position: 'relative',
    overflow: 'hidden',
  },
  fullStage: {
    ...StyleSheet.absoluteFill,
  },

  /* ── TOP OVERLAY (Mission | Golden ATB Rail | Speed & Auto) ── */
  topOverlay: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    zIndex: 20,
  },
  missionChip: {
    backgroundColor: 'rgba(7, 11, 20, 0.78)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(200, 162, 74, 0.55)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    maxWidth: 165,
  },
  missionTitle: {
    color: '#F8FAFC',
    fontSize: 10,
    fontWeight: '800',
  },
  missionSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
  },
  roundBadge: {
    color: '#FACC15',
    fontSize: 8.5,
    fontWeight: '900',
  },
  turnStateText: {
    color: '#94A3B8',
    fontSize: 8.5,
    fontWeight: '800',
  },
  turnStatePlayer: {
    color: '#4ADE80',
  },

  /* Ninja Horizon Top-Center ATB Bar */
  atbRailOuter: {
    flex: 1,
    maxWidth: 520,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(7, 11, 20, 0.84)',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#C8A24A',
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 5,
    elevation: 6,
  },
  atbStartCap: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#475569',
    marginRight: 4,
  },
  atbCapText: {
    color: '#CBD5E1',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  atbTrack: {
    flex: 1,
    height: 24,
    backgroundColor: '#0B1220',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    position: 'relative',
    justifyContent: 'center',
    overflow: 'visible',
  },
  atbRailGlow: {
    position: 'absolute',
    left: 2,
    right: 2,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(200, 162, 74, 0.35)',
  },
  atbTick: {
    position: 'absolute',
    top: 1,
    bottom: 1,
    width: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.35)',
  },
  atbActCap: {
    backgroundColor: '#B45309',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#FDE047',
    marginLeft: 4,
  },
  atbActText: {
    color: '#FEF9C3',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  topRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ctrlPill: {
    backgroundColor: 'rgba(7, 11, 20, 0.82)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1.25,
    borderColor: 'rgba(200, 162, 74, 0.6)',
  },
  ctrlPillActive: {
    backgroundColor: '#0369A1',
    borderColor: '#38BDF8',
  },
  ctrlAutoActive: {
    backgroundColor: '#B45309',
    borderColor: '#FACC15',
  },
  ctrlPillText: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '900',
  },
  ctrlPillTextActive: {
    color: '#FFFFFF',
  },

  /* ── IDENTICAL-SIZE PIXEL-ALIGNED HP & CP PLATES (PLAYER & ENEMY) ── */
  unitPlatesLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 12,
  },
  unitPlate: {
    position: 'absolute',
    width: UNIT_PLATE_W,
    backgroundColor: 'rgba(7, 11, 20, 0.8)',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 3,
    gap: 1.5,
  },
  playerPlateBorder: {
    borderColor: 'rgba(56, 189, 248, 0.75)',
  },
  allyPlateBorder: {
    borderColor: 'rgba(52, 211, 153, 0.8)',
  },
  enemyPlateBorder: {
    borderColor: 'rgba(248, 113, 113, 0.6)',
  },
  enemyPlateSelected: {
    borderColor: '#FACC15',
    borderWidth: 1.5,
    backgroundColor: 'rgba(24, 24, 38, 0.9)',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 4,
    elevation: 5,
  },
  enemyPlateDead: {
    opacity: 0.35,
  },
  targetPin: {
    position: 'absolute',
    top: -11,
    right: -4,
    backgroundColor: '#D97706',
    borderRadius: 8,
    paddingHorizontal: 3.5,
    paddingVertical: 0.5,
    borderWidth: 0.75,
    borderColor: '#FEF08A',
  },
  targetPinText: {
    color: '#FFF',
    fontSize: 7.5,
    fontWeight: '900',
  },
  plateNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  plateName: {
    color: '#F8FAFC',
    fontSize: 8.5,
    fontWeight: '800',
    flex: 1,
  },
  plateLv: {
    color: '#FACC15',
    fontSize: 7.5,
    fontWeight: '900',
    marginLeft: 3,
  },
  unitBarBg: {
    height: 9.5,
    backgroundColor: '#1E293B',
    borderRadius: 3.5,
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  unitHpFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#22C55E',
  },
  unitEnemyHpFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#EF4444',
  },
  unitCpFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#0EA5E9',
  },
  unitBarText: {
    color: '#FFFFFF',
    fontSize: 7,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    marginTop: 1,
  },
  statusPill: {
    paddingHorizontal: 3.5,
    paddingVertical: 0.5,
    borderRadius: 3.5,
    borderWidth: 0.75,
  },
  statusPillBuff: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    borderColor: '#34D399',
  },
  statusPillDebuff: {
    backgroundColor: 'rgba(239, 68, 68, 0.28)',
    borderColor: '#F87171',
  },
  statusText: {
    color: '#F8FAFC',
    fontSize: 7,
    fontWeight: '800',
  },

  /* ── FLOATING COMBAT POPUPS ── */
  leftFloatZone: {
    position: 'absolute',
    left: '18%',
    top: '32%',
    alignItems: 'center',
    zIndex: 18,
  },
  rightFloatZone: {
    position: 'absolute',
    right: '18%',
    top: '32%',
    alignItems: 'center',
    zIndex: 18,
  },

  /* ── LOG TOAST & FLOATING ACTION DOCK ── */
  logToastWrap: {
    position: 'absolute',
    bottom: 74,
    alignSelf: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 3,
    maxWidth: '72%',
    zIndex: 16,
  },
  logToastText: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  bottomDockWrap: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 22,
  },
  bottomDock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(7, 11, 20, 0.82)',
    borderRadius: 14,
    borderWidth: 1.25,
    borderColor: 'rgba(200, 162, 74, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.75,
    shadowRadius: 8,
    elevation: 8,
  },
  dockDivider: {
    width: 1,
    height: 38,
    backgroundColor: 'rgba(200, 162, 74, 0.35)',
    marginHorizontal: 1,
  },

  itemJutsuTile: {
    width: 44,
    height: 44,
    borderRadius: 9,
    borderWidth: 1.75,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  itemTileIcon: {
    width: 40,
    height: 40,
    borderRadius: 7,
  },
  itemLvBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderBottomLeftRadius: 5,
    borderLeftWidth: 0.75,
    borderBottomWidth: 0.75,
    borderColor: '#FACC15',
    paddingHorizontal: 3.5,
    paddingVertical: 0.5,
  },
  itemLvText: {
    color: '#FDE047',
    fontSize: 7.5,
    fontWeight: '900',
  },
  itemQtyBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.88)',
    borderTopLeftRadius: 5,
    paddingHorizontal: 3.5,
    paddingVertical: 0.5,
  },
  itemQtyText: {
    color: '#F8FAFC',
    fontSize: 8,
    fontWeight: '900',
  },

  /* ── TOOLTIPS, ITEMS, MODALS ── */
  tooltipOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 35,
  },
  tooltipCard: {
    width: 300,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    padding: 12,
    gap: 5,
  },
  tooltipHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tooltipTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '900',
    flex: 1,
  },
  tooltipElem: {
    color: '#FACC15',
    fontSize: 10,
    fontWeight: '800',
  },
  tooltipStats: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  tooltipDesc: {
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 15,
  },
  inspectSkillIcon: {
    width: 34,
    height: 34,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C8A24A',
    backgroundColor: '#060B14',
  },
  inspectCard: {
    width: 390,
    maxWidth: '90%',
    backgroundColor: 'rgba(10, 15, 28, 0.96)',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#C8A24A',
    padding: 12,
    gap: 8,
  },
  inspectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  inspectTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  inspectSideTag: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  inspectTagPlayer: {
    backgroundColor: '#0369A1',
  },
  inspectTagAlly: {
    backgroundColor: '#047857',
  },
  inspectTagEnemy: {
    backgroundColor: '#B91C1C',
  },
  inspectSideText: {
    color: '#FFF',
    fontSize: 8.5,
    fontWeight: '900',
  },
  inspectName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '900',
    flexShrink: 1,
  },
  inspectLv: {
    color: '#FACC15',
    fontSize: 11,
    fontWeight: '900',
  },
  inspectCloseBtn: {
    backgroundColor: '#1E293B',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  inspectCloseTxt: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '900',
  },
  inspectBarsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  inspectBarWrap: {
    flex: 1,
    height: 14,
    backgroundColor: '#1E293B',
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  inspectBarTxt: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  inspectStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  inspectStatBox: {
    width: '23.5%',
    backgroundColor: '#0F172A',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  inspectStatLabel: {
    color: '#94A3B8',
    fontSize: 8,
    fontWeight: '700',
  },
  inspectStatVal: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '900',
    marginTop: 1,
  },
  inspectStatusSection: {
    backgroundColor: '#0F172A',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 7,
    gap: 4,
  },
  inspectSectionTitle: {
    color: '#FACC15',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  inspectEmptyText: {
    color: '#64748B',
    fontSize: 10,
    fontStyle: 'italic',
  },
  inspectStatusList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  inspectStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  inspectRowBuff: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: '#34D399',
  },
  inspectRowDebuff: {
    backgroundColor: 'rgba(239, 68, 68, 0.22)',
    borderColor: '#F87171',
  },
  inspectStatusName: {
    color: '#F8FAFC',
    fontSize: 9.5,
    fontWeight: '800',
  },
  inspectStatusTurns: {
    color: '#FDE047',
    fontSize: 9,
    fontWeight: '900',
  },
  itemsDrawer: {
    position: 'absolute',
    bottom: 76,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderRadius: 10,
    borderWidth: 1.25,
    borderColor: '#2DD4BF',
    padding: 8,
    zIndex: 28,
  },
  itemChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#475569',
  },
  itemIcon: {
    fontSize: 16,
  },
  itemName: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '800',
  },
  itemDesc: {
    color: '#94A3B8',
    fontSize: 9,
  },
  itemCloseBtn: {
    backgroundColor: '#334155',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  itemCloseTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
  },
  resultOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
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
  resultTitleDefeat: {
    color: '#EF4444',
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
  premBonusTxt: {
    color: '#FDE047',
    fontSize: 11,
    fontWeight: '900',
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
    fontSize: 12,
    fontWeight: '800',
  },
  fleeCard: {
    width: 340,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#475569',
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  fleeTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '900',
  },
  fleeSub: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'center',
  },
  fleeBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  fleeModalBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 7,
  },
  fleeTryBtn: {
    backgroundColor: '#0284C7',
  },
  fleeQuitBtn: {
    backgroundColor: '#DC2626',
  },
  fleeCancelBtn: {
    backgroundColor: '#334155',
  },
  disabledBtn: {
    opacity: 0.4,
  },
});
