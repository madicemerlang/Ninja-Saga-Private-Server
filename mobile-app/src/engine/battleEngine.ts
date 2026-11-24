import type { PetJsonDef, RawSkillEffectDef, SkillDef } from '../api/gameData';
import type { CharacterPoints } from '../store/useAuthStore';

export interface StatusEffect {
  id: string;
  name: string;
  shortCode: string;
  icon: string;
  type: 'Buff' | 'Debuff';
  turns: number;
  amount: number;
  amountCp?: number;
  amountProtection?: number;
  calcType: 'percent' | 'number' | '';
  noDisperse?: boolean;
}

export interface Combatant {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  cp: number;
  maxCp: number;
  agility: number;
  baseDamage: number;
  weaponDamage?: number;
  points?: CharacterPoints;
  critChance: number;
  dodgeChance: number;
  accuracyChance?: number;
  purifyChance?: number;
  reactiveChance?: number;
  combustionChance?: number;
  combustionTurns?: number;
  attackCooldowns?: Record<number, number>;
  statuses: StatusEffect[];
  /** @deprecated kept for backwards compatibility; use statuses[] */
  debuffs?: string[];
}

export interface EnemyAttackSpec {
  index?: number;
  dmg?: number;
  cooldown?: number;
  animation?: string;
  effects?: RawSkillEffectDef[];
}

export type FloatKind = 'damage' | 'crit' | 'cp' | 'dodge' | 'heal' | 'buff' | 'debuff';

export interface FloatingNumber {
  id: number;
  target: 'player' | 'enemy';
  targetSlot?: number;
  text: string;
  kind: FloatKind;
}

export interface TurnOutcome {
  player: Combatant;
  enemy: Combatant;
  cooldowns: Record<string, number>;
  floats: FloatingNumber[];
  log: string;
  skillSwfToPlay?: string;
  didCrit?: boolean;
  wasDodged?: boolean;
}

export interface MultiTurnOutcome {
  player: Combatant;
  enemies: Combatant[];
  cooldowns: Record<string, number>;
  floats: FloatingNumber[];
  log: string;
  skillSwfToPlay?: string;
  didCrit?: boolean;
  wasDodged?: boolean;
  isAoE?: boolean;
}

export interface BattleConsumable {
  id: 'hp_scroll' | 'cp_scroll' | 'purify_pill';
  name: string;
  icon: string;
  desc: string;
  qty: number;
}

export interface SkillElementMeta {
  label: string;
  icon: string;
  bg: string;
  border: string;
}

export interface TurnStartResult {
  combatant: Combatant;
  floats: FloatingNumber[];
  log?: string;
  skipTurn: boolean;
  skipReason?: string;
  diedFromDot: boolean;
}

export interface TimelineParticipant {
  id: string; // 'player' | 'ene_0' | 'ene_1' | 'ene_2'
  name: string;
  agility: number;
  isPlayer: boolean;
  isAlive: boolean;
}

let floatSeq = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Status Effect Metadata (Authentic Ninja Saga Icons & Short Labels)
// ─────────────────────────────────────────────────────────────────────────────

interface EffectMeta {
  name: string;
  shortCode: string;
  icon: string;
}

const EFFECT_META: Record<string, EffectMeta> = {
  // Hard Crowd Control
  stun: { name: 'Stun', shortCode: 'STN', icon: '💫' },
  sleep: { name: 'Sleep', shortCode: 'SLP', icon: '💤' },
  frozen: { name: 'Frozen', shortCode: 'FRZ', icon: '❄️' },
  petrify: { name: 'Petrify', shortCode: 'PTR', icon: '🪨' },
  prison: { name: 'Prison', shortCode: 'PRS', icon: '⛓️' },
  fear: { name: 'Fear', shortCode: 'FER', icon: '😱' },
  chaos: { name: 'Chaos', shortCode: 'CHS', icon: '🌀' },

  // Restrictions
  restriction: { name: 'Restriction', shortCode: 'RST', icon: '🚫' },
  meridian_seal: { name: 'Meridian Seal', shortCode: 'MSL', icon: '🔒' },
  lock: { name: 'Lock', shortCode: 'LCK', icon: '🔐' },
  charge_disable: { name: 'No Charge', shortCode: 'NCH', icon: '⛔' },
  dismantle: { name: 'Dismantle', shortCode: 'DSM', icon: '🗡️' },
  internal_injury: { name: 'Internal Injury', shortCode: 'INJ', icon: '💔' },

  // Damage Over Time
  burn: { name: 'Burn', shortCode: 'BRN', icon: '🔥' },
  burning: { name: 'Burning', shortCode: 'BRN', icon: '🔥' },
  burningX: { name: 'Burning', shortCode: 'BRN', icon: '🔥' },
  blaze: { name: 'Blaze', shortCode: 'BLZ', icon: '🔥' },
  flaming: { name: 'Flaming', shortCode: 'FLM', icon: '🔥' },
  poison: { name: 'Poison', shortCode: 'PSN', icon: '☠️' },
  reduce_hp: { name: 'Reduce HP', shortCode: 'DOT', icon: '🩸' },
  reduce_hp_cp: { name: 'Drain', shortCode: 'DRN', icon: '🟣' },
  conduction: { name: 'Conduction', shortCode: 'CND', icon: '⚡' },
  theft: { name: 'Theft', shortCode: 'THF', icon: '💸' },

  // Stat Debuffs
  bleeding: { name: 'Bleeding', shortCode: 'BLD', icon: '🩸' },
  weaken: { name: 'Weaken', shortCode: 'WKN', icon: '⬇️' },
  embrace: { name: 'Embrace', shortCode: 'EMB', icon: '🕸️' },
  blind: { name: 'Blind', shortCode: 'BLN', icon: '👁️' },
  darkness: { name: 'Darkness', shortCode: 'DRK', icon: '🌑' },
  dark_curse: { name: 'Dark Curse', shortCode: 'CRS', icon: '👿' },
  shadow: { name: 'Shadow', shortCode: 'SHW', icon: '👤' },
  disorient: { name: 'Disorient', shortCode: 'DSO', icon: '😵' },
  numb: { name: 'Numb', shortCode: 'NMB', icon: '⚡' },
  slow: { name: 'Slow', shortCode: 'SLW', icon: '🐌' },
  muddy: { name: 'Muddy', shortCode: 'MUD', icon: '🟤' },
  cp_cost: { name: 'CP Cost+', shortCode: 'CP+', icon: '💧' },

  // Buffs
  power_up: { name: 'Strengthen', shortCode: 'STR', icon: '⚔️' },
  strengthen: { name: 'Strengthen', shortCode: 'STR', icon: '⚔️' },
  rage: { name: 'Rage', shortCode: 'RAG', icon: '💢' },
  excitation: { name: 'Excitation', shortCode: 'EXC', icon: '⚡' },
  combustion: { name: 'Combustion', shortCode: 'CMB', icon: '🔥' },
  stealth: { name: 'Stealth', shortCode: 'STL', icon: '🌫️' },
  protection: { name: 'Protection', shortCode: 'PRO', icon: '🛡️' },
  plus_protection: { name: 'Protection+', shortCode: 'PRO', icon: '🛡️' },
  tolerance: { name: 'Tolerance', shortCode: 'TOL', icon: '🧱' },
  cp_shield: { name: 'CP Shield', shortCode: 'SHD', icon: '🔷' },
  reflexes: { name: 'Flexible', shortCode: 'FLX', icon: '💨' },
  attention: { name: 'Attention', shortCode: 'ATT', icon: '👀' },
  concentration: { name: 'Concentration', shortCode: 'CNC', icon: '🎯' },
  debuff_resist: { name: 'Debuff Resist', shortCode: 'RES', icon: '✨' },
  regenHP: { name: 'Recover HP', shortCode: 'REG', icon: '💚' },
  regeneration: { name: 'Regeneration', shortCode: 'REG', icon: '💚' },
  restoration: { name: 'Restoration', shortCode: 'CPR', icon: '💙' },
  energize: { name: 'Energize', shortCode: 'ENR', icon: '🔋' },
  peace: { name: 'Peace', shortCode: 'PCE', icon: '☯️' },
  lightning_armor: { name: 'Lightning Armor', shortCode: 'LAR', icon: '⚡' },
  fire_wall: { name: 'Fire Wall', shortCode: 'FWL', icon: '🔥' },
  bloodfeed: { name: 'Bloodfeed', shortCode: 'BLF', icon: '🧛' },
  serene_mind: { name: 'Serene Mind', shortCode: 'SRN', icon: '🧘' },
  increase_agility: { name: 'Agility+', shortCode: 'AGI', icon: '🏃' },
  plus_extra_hp: { name: 'Heal+', shortCode: 'HL+', icon: '➕' },
  dec_cp_attacker: { name: 'CP Counter', shortCode: 'CPC', icon: '🔵' },
};

function getEffectMeta(id: string, fallbackName?: string): EffectMeta {
  const known = EFFECT_META[id];
  if (known) return known;
  const label = fallbackName || id.replace(/_/g, ' ');
  return {
    name: label,
    shortCode: label.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'EFF',
    icon: '✦',
  };
}

/**
 * Applies an authentic Ninja Saga NPC buff/debuff/heal effect directly onto a Combatant,
 * normalizing NPC JSON aliases (e.g. 'flexible' -> 'reflexes') so all battleEngine modifiers work!
 */
export function applyNpcStatusEffect(
  unit: Combatant,
  rawEff: {
    effect?: string;
    effect_name?: string;
    type?: string;
    duration?: number;
    amount?: number;
    calc_type?: string;
  }
): { combatant: Combatant; applied?: StatusEffect; healed?: number } {
  const rawId = String(rawEff.effect ?? '').trim();
  if (!rawId) return { combatant: unit };

  const normalizedId = rawId === 'flexible' ? 'reflexes' : rawId;
  const amount = Number(rawEff.amount ?? 0);
  const calcType: 'percent' | 'number' = rawEff.calc_type === 'number' ? 'number' : 'percent';

  if (normalizedId === 'heal') {
    const healAmt =
      calcType === 'number'
        ? Math.max(10, Math.round(amount || unit.maxHp * 0.2))
        : Math.max(15, Math.round((unit.maxHp * (amount || 20)) / 100));
    return {
      combatant: { ...unit, hp: Math.min(unit.maxHp, unit.hp + healAmt) },
      healed: healAmt,
    };
  }

  const meta = getEffectMeta(normalizedId, rawEff.effect_name);
  const turns = Math.max(1, Number(rawEff.duration ?? 2));
  const statusType: 'Buff' | 'Debuff' = rawEff.type === 'Buff' ? 'Buff' : 'Debuff';
  const nextStatus: StatusEffect = {
    id: normalizedId,
    name: meta.name,
    shortCode: meta.shortCode,
    icon: meta.icon,
    type: statusType,
    turns,
    amount,
    calcType,
  };
  const filtered = (unit.statuses ?? []).filter((s) => s.id !== normalizedId);
  return {
    combatant: { ...unit, statuses: [...filtered, nextStatus] },
    applied: nextStatus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Query & Modifier Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getStatuses(c: Combatant): StatusEffect[] {
  return c.statuses ?? [];
}

export function hasStatus(c: Combatant, ...ids: string[]): boolean {
  const list = getStatuses(c);
  return list.some((s) => s.turns > 0 && ids.includes(s.id));
}

export function getStatusAmountSum(c: Combatant, ...ids: string[]): number {
  let sum = 0;
  for (const s of getStatuses(c)) {
    if (s.turns > 0 && ids.includes(s.id)) {
      sum += s.amount || 0;
    }
  }
  return sum;
}

export function isSkillsRestricted(c: Combatant): boolean {
  return hasStatus(c, 'restriction', 'meridian_seal', 'lock');
}

export function isChargeDisabled(c: Combatant): boolean {
  return hasStatus(c, 'charge_disable', 'meridian_seal');
}

export function getEffectiveSkillCpCost(c: Combatant, baseCost: number): number {
  if (hasStatus(c, 'serene_mind')) return 0;
  const extraPct = getStatusAmountSum(c, 'cp_cost');
  if (extraPct > 0) {
    return Math.round(baseCost * (1 + extraPct / 100));
  }
  return Math.max(0, baseCost);
}

export function getEffectiveAgility(c: Combatant): number {
  let mult = 1.0;
  for (const s of getStatuses(c)) {
    if (s.turns <= 0) continue;
    if (s.id === 'increase_agility') {
      mult += (s.amount || 20) / 100;
    } else if (s.id === 'slow' || s.id === 'muddy') {
      mult -= (s.amount || 20) / 100;
    }
  }
  return Math.max(1, Math.round(c.agility * Math.max(0.2, mult)));
}

function getEffectiveDodgeChance(attacker: Combatant, defender: Combatant): number {
  // Stealth grants 100% evasion/protection until attacking
  if (hasStatus(defender, 'stealth')) {
    const stl = getStatuses(defender).find((s) => s.id === 'stealth');
    if ((stl?.amountProtection ?? 100) >= 100) return 1.0;
  }

  let dodge = defender.dodgeChance ?? 0.05;
  // Defender dodge buffs
  dodge += getStatusAmountSum(defender, 'reflexes', 'attention') / 100;
  // Defender dodge debuffs (Numb reduces dodge)
  dodge -= getStatusAmountSum(defender, 'numb') / 100;
  // Attacker accuracy directly counters defender dodge (canonical Ninja Saga accuracy attribute)
  dodge -= attacker.accuracyChance ?? 0;
  // Attacker accuracy debuffs (Blind, Darkness, Dark Curse, Shadow, Disorient increase defender dodge)
  dodge += getStatusAmountSum(attacker, 'blind', 'darkness', 'dark_curse', 'shadow', 'disorient') / 100;

  return Math.max(0, Math.min(0.85, dodge));
}

export function getEffectiveUnitDodgeChance(unit: Combatant): number {
  if (hasStatus(unit, 'stealth')) {
    const stl = getStatuses(unit).find((s) => s.id === 'stealth');
    if ((stl?.amountProtection ?? 100) >= 100) return 1.0;
  }
  let dodge = unit.dodgeChance ?? 0.05;
  dodge += getStatusAmountSum(unit, 'reflexes', 'attention') / 100;
  dodge -= getStatusAmountSum(unit, 'numb') / 100;
  return Math.max(0, Math.min(1.0, dodge));
}

export function getEffectiveUnitAccuracyChance(unit: Combatant): number {
  let acc = unit.accuracyChance ?? 0;
  acc -= getStatusAmountSum(unit, 'blind', 'darkness', 'dark_curse', 'shadow', 'disorient') / 100;
  return acc;
}

export function getEffectiveCritChance(attacker: Combatant): number {
  let crit = attacker.critChance ?? 0.05;
  crit += getStatusAmountSum(attacker, 'concentration') / 100;
  if (hasStatus(attacker, 'excitation')) {
    crit += 0.5;
  }
  return Math.max(0, Math.min(0.95, crit));
}

export function getOutgoingDamageMultiplier(attacker: Combatant): number {
  let mult = 1.0;
  for (const s of getStatuses(attacker)) {
    if (s.turns <= 0) continue;
    if (s.id === 'power_up' || s.id === 'strengthen' || s.id === 'rage' || s.id === 'combustion') {
      if (s.calcType === 'number') {
        mult += (s.amount || 0) / 100;
      } else {
        mult += (s.amount || 0) / 100;
      }
    } else if (s.id === 'excitation') {
      mult += 0.35;
    } else if (s.id === 'stealth') {
      mult += (s.amount || 75) / 100;
    } else if (s.id === 'weaken' || s.id === 'embrace') {
      mult -= (s.amount || 20) / 100;
    }
  }
  return Math.max(0.15, mult);
}

function applyIncomingDamageModifiers(
  rawDmg: number,
  defender: Combatant,
  defenderSide: 'player' | 'enemy',
  floats: FloatingNumber[]
): number {
  let mult = 1.0;
  let flatReduce = 0;

  for (const s of getStatuses(defender)) {
    if (s.turns <= 0) continue;
    if (s.id === 'protection' || s.id === 'plus_protection') {
      mult -= (s.amount || 0) / 100;
    } else if (s.id === 'frozen') {
      mult -= (s.amount || 80) / 100;
    } else if (s.id === 'bleeding') {
      mult += (s.amount || 25) / 100;
    } else if (s.id === 'tolerance') {
      flatReduce += s.amount || 0;
    }
  }

  let dmg = Math.max(0, Math.round(rawDmg * Math.max(0.05, mult)) - flatReduce);

  // CP Shield: converts incoming HP damage into CP loss
  if (dmg > 0 && hasStatus(defender, 'cp_shield') && defender.cp > 0) {
    const shieldEff = getStatuses(defender).find((s) => s.id === 'cp_shield');
    const ratio = Math.max(1, shieldEff?.amount || 2);
    const cpNeeded = Math.round(dmg / ratio);
    const cpSpent = Math.min(defender.cp, Math.max(1, cpNeeded));
    const absorbed = Math.min(dmg, cpSpent * ratio);
    defender.cp = Math.max(0, defender.cp - cpSpent);
    dmg = Math.max(0, dmg - absorbed);
    floats.push({
      id: floatSeq++,
      target: defenderSide,
      text: `CP SHIELD (-${cpSpent} CP)`,
      kind: 'cp',
    });
  }

  return dmg;
}

function upsertStatus(target: Combatant, next: StatusEffect): void {
  const list = [...getStatuses(target)];
  const idx = list.findIndex((s) => s.id === next.id);
  if (idx >= 0) {
    list[idx] = {
      ...next,
      turns: Math.max(list[idx].turns, next.turns),
      amount: Math.max(list[idx].amount, next.amount),
    };
  } else {
    list.push(next);
  }
  target.statuses = list;
}

function removeStatus(target: Combatant, ...ids: string[]): boolean {
  const list = getStatuses(target);
  const filtered = list.filter((s) => !ids.includes(s.id));
  if (filtered.length !== list.length) {
    target.statuses = filtered;
    return true;
  }
  return false;
}

function tickDownStatuses(c: Combatant, excludeIds?: Set<string>): void {
  const next: StatusEffect[] = [];
  for (const s of getStatuses(c)) {
    if (excludeIds && excludeIds.has(s.id)) {
      next.push(s);
      continue;
    }
    const rem = s.turns - 1;
    if (rem > 0) {
      next.push({ ...s, turns: rem });
    }
  }
  c.statuses = next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agility Timeline
// ─────────────────────────────────────────────────────────────────────────────

export function advanceAgilityTimeline(
  participants: TimelineParticipant[],
  currentGauges: Record<string, number>
): {
  actorId: string;
  nextGauges: Record<string, number>;
} {
  const alive = participants.filter((p) => p.isAlive);
  if (alive.length === 0) {
    return { actorId: '', nextGauges: currentGauges };
  }

  const alreadyReady = alive.find((p) => (currentGauges[p.id] ?? 0) >= 100);
  if (alreadyReady) {
    return { actorId: alreadyReady.id, nextGauges: { ...currentGauges } };
  }

  let minTime = Infinity;
  let winnerId = alive[0].id;

  for (const p of alive) {
    const cur = Math.max(0, currentGauges[p.id] ?? 0);
    const effAgi = Math.max(1, p.agility);
    const timeNeeded = Math.max(0, (100 - cur) / effAgi);
    if (timeNeeded < minTime) {
      minTime = timeNeeded;
      winnerId = p.id;
    } else if (timeNeeded === minTime && p.isPlayer) {
      winnerId = p.id;
    }
  }

  const nextGauges: Record<string, number> = {};
  for (const p of participants) {
    if (!p.isAlive) {
      nextGauges[p.id] = 0;
      continue;
    }
    const cur = Math.max(0, currentGauges[p.id] ?? 0);
    const effAgi = Math.max(1, p.agility);
    const advanced = cur + minTime * effAgi;
    if (p.id === winnerId) {
      nextGauges[p.id] = 100;
    } else {
      nextGauges[p.id] = Math.min(99.9, Number(advanced.toFixed(2)));
    }
  }

  return { actorId: winnerId, nextGauges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Combatant Builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildPlayerCombatant(
  name: string,
  level: number,
  points?: CharacterPoints,
  weaponDamage = 0
): Combatant {
  const lvl = Math.max(1, level);
  const p = points ?? { wind: 0, fire: 0, lightning: 0, water: 0, earth: 0, free: 0 };

  const maxHp = 100 + lvl * 40 + p.earth * 30;
  const maxCp = 100 + lvl * 40 + p.water * 30;
  const agility = 9 + lvl + p.wind * 1;
  const dodgeChance = Math.min(0.60, 0.05 + p.wind * 0.004);
  const critChance = Math.min(0.70, 0.05 + p.lightning * 0.004);
  const effectiveWpn = Math.max(0, weaponDamage);

  return {
    id: 'player',
    name,
    level: lvl,
    hp: maxHp,
    maxHp,
    cp: maxCp,
    maxCp,
    agility,
    baseDamage: effectiveWpn,
    weaponDamage: effectiveWpn,
    points: p,
    critChance,
    dodgeChance,
    accuracyChance: 0,
    purifyChance: p.water * 0.004,
    reactiveChance: p.earth * 0.004,
    combustionChance: p.fire * 0.004,
    combustionTurns: 0,
    statuses: [],
    debuffs: [],
  };
}

/**
 * Builds an Enemy combatant using the exact original Ninja Saga attributes from enemy.json:
 * hp, cp, agility, dodge%, critical%, accuracy%, purify%, reactive%, combustion%.
 */
export function buildEnemyCombatant(
  raw: {
    id: string;
    name: string;
    level: number;
    hp: number;
    cp: number;
    agility: number;
    dodge?: number;
    critical?: number;
    accuracy?: number;
    purify?: number;
    reactive?: number;
    combustion?: number;
  },
  fallbackIdx = 0
): Combatant {
  const lvl = Math.max(1, raw.level || 1);
  const hp = raw.hp && raw.hp > 0 ? raw.hp : 60 + lvl * 40;
  const cp = raw.cp && raw.cp > 0 ? raw.cp : 60 + lvl * 40;
  const agility = raw.agility && raw.agility > 0 ? raw.agility : 8 + lvl;

  return {
    id: raw.id || `ene_0${fallbackIdx + 1}`,
    name: raw.name || `Enemy #${fallbackIdx + 1}`,
    level: lvl,
    hp,
    maxHp: hp,
    cp,
    maxCp: cp,
    agility,
    // Canonical base attack scaling for multiplier-based enemy attacks (dmg: 1, 2, 3)
    baseDamage: 8 + lvl * 4,
    critChance: Math.max(0, Math.min(0.95, (raw.critical ?? 5) / 100)),
    dodgeChance: Math.max(0, Math.min(0.85, (raw.dodge ?? 0) / 100)),
    accuracyChance: Math.max(0, (raw.accuracy ?? 0) / 100),
    purifyChance: Math.max(0, (raw.purify ?? 5) / 100),
    reactiveChance: Math.max(0, (raw.reactive ?? 5) / 100),
    combustionChance: Math.max(0, (raw.combustion ?? 0) / 100),
    attackCooldowns: {},
    statuses: [],
    debuffs: [],
  };
}

export function tickCooldowns(cd: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(cd)) {
    if (v > 1) next[k] = v - 1;
  }
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn-Start Status Processing (Water Purify, DoTs, HoTs, Hard CC, Chaos)
// ─────────────────────────────────────────────────────────────────────────────

const HARD_CC_IDS = ['stun', 'sleep', 'frozen', 'petrify', 'prison', 'fear'];
const DOT_HP_IDS = ['burn', 'burning', 'burningX', 'blaze', 'flaming', 'poison', 'reduce_hp', 'conduction', 'theft'];

export function processTurnStart(
  combatant: Combatant,
  side: 'player' | 'enemy'
): TurnStartResult {
  const next: Combatant = {
    ...combatant,
    statuses: [...getStatuses(combatant)],
  };
  const floats: FloatingNumber[] = [];
  const logs: string[] = [];

  // 1) Purify at turn start: Player Water passive (0.4%/pt) OR Enemy native purify% from enemy.json
  const waterPts = next.points?.water ?? 0;
  const purifyRate = next.purifyChance ?? (waterPts * 0.004);
  if (purifyRate > 0 && next.statuses.some((s) => s.type === 'Debuff')) {
    if (Math.random() < purifyRate) {
      next.statuses = next.statuses.filter((s) => s.type !== 'Debuff');
      floats.push({
        id: floatSeq++,
        target: side,
        text: 'PURIFY!',
        kind: 'buff',
      });
      logs.push(`${next.name} purified all debuffs!`);
    }
  }

  const healBlocked = hasStatus(next, 'internal_injury');
  const waterHealMult = 1.0 + (waterPts * 0.01) + (getStatusAmountSum(next, 'plus_extra_hp') / 100);

  // 2) Tick DoTs & HoTs
  for (const s of next.statuses) {
    if (s.turns <= 0) continue;

    // HP DoTs (Burn, Poison, Reduce HP, Conduction, Theft)
    if (DOT_HP_IDS.includes(s.id)) {
      const dmg =
        s.calcType === 'number'
          ? Math.max(1, Math.round(s.amount))
          : Math.max(1, Math.round((next.maxHp * Math.max(1, s.amount)) / 100));
      next.hp = Math.max(0, next.hp - dmg);
      floats.push({
        id: floatSeq++,
        target: side,
        text: `${s.name.toUpperCase()} -${dmg}`,
        kind: 'debuff',
      });
      logs.push(`${next.name} took ${dmg} ${s.name} damage.`);
    }

    // Dual HP & CP Drain (Prison, Reduce HP & CP)
    if (s.id === 'reduce_hp_cp' || s.id === 'prison') {
      const hpLoss =
        s.amount > 0
          ? s.calcType === 'number'
            ? Math.round(s.amount)
            : Math.max(1, Math.round((next.maxHp * s.amount) / 100))
          : 0;
      const cpLoss =
        (s.amountCp ?? 0) > 0
          ? Math.max(1, Math.round((next.maxCp * (s.amountCp ?? 0)) / 100))
          : 0;
      if (hpLoss > 0) {
        next.hp = Math.max(0, next.hp - hpLoss);
        floats.push({ id: floatSeq++, target: side, text: `${s.name.toUpperCase()} -${hpLoss}`, kind: 'debuff' });
      }
      if (cpLoss > 0) {
        next.cp = Math.max(0, next.cp - cpLoss);
        floats.push({ id: floatSeq++, target: side, text: `-${cpLoss} CP`, kind: 'cp' });
      }
    }

    // HP HoT (Regen HP, Regeneration, Peace)
    if (s.id === 'regenHP' || s.id === 'regeneration' || s.id === 'peace') {
      if (!healBlocked && next.hp > 0) {
        const baseHeal =
          s.calcType === 'number'
            ? Math.max(1, Math.round(s.amount))
            : Math.max(1, Math.round((next.maxHp * Math.max(1, s.amount)) / 100));
        const healAmt = Math.round(baseHeal * waterHealMult);
        next.hp = Math.min(next.maxHp, next.hp + healAmt);
        floats.push({ id: floatSeq++, target: side, text: `+${healAmt} HP`, kind: 'heal' });
      }
    }

    // CP HoT (Restoration, Energize, Peace)
    if (s.id === 'restoration' || s.id === 'energize' || s.id === 'peace') {
      const pct = s.amountCp ?? s.amount ?? 10;
      const cpAmt =
        s.calcType === 'number'
          ? Math.max(1, Math.round(pct))
          : Math.max(1, Math.round((next.maxCp * Math.max(1, pct)) / 100));
      next.cp = Math.min(next.maxCp, next.cp + cpAmt);
      floats.push({ id: floatSeq++, target: side, text: `+${cpAmt} CP`, kind: 'cp' });
    }
  }

  // Did combatant die from DoT?
  if (next.hp <= 0) {
    tickDownStatuses(next);
    return {
      combatant: next,
      floats,
      log: logs.join(' ') || `${next.name} succumbed to status effects!`,
      skipTurn: true,
      skipReason: 'KO',
      diedFromDot: true,
    };
  }

  // 3) Check Hard Crowd Control (Stun, Sleep, Frozen, Petrify, Prison, Fear)
  const cc = next.statuses.find((s) => s.turns > 0 && HARD_CC_IDS.includes(s.id));
  if (cc) {
    floats.push({
      id: floatSeq++,
      target: side,
      text: `${cc.name.toUpperCase()}!`,
      kind: 'debuff',
    });
    tickDownStatuses(next);
    return {
      combatant: next,
      floats,
      log: `${next.name} is affected by ${cc.name} and cannot act!`,
      skipTurn: true,
      skipReason: cc.name,
      diedFromDot: false,
    };
  }

  // 4) Check Chaos (attacks self & skips turn)
  if (hasStatus(next, 'chaos')) {
    const selfBase = Math.max(5, next.weaponDamage || next.baseDamage || 10);
    const selfDmg = Math.max(1, Math.round(selfBase * (0.7 + Math.random() * 0.3)));
    next.hp = Math.max(0, next.hp - selfDmg);
    floats.push({
      id: floatSeq++,
      target: side,
      text: `CHAOS! -${selfDmg}`,
      kind: 'debuff',
    });
    tickDownStatuses(next);
    return {
      combatant: next,
      floats,
      log: `${next.name} is in Chaos and struck themselves for ${selfDmg} dmg!`,
      skipTurn: true,
      skipReason: 'Chaos',
      diedFromDot: next.hp <= 0,
    };
  }

  return {
    combatant: next,
    floats,
    log: logs.length > 0 ? logs.join(' ') : undefined,
    skipTurn: false,
    diedFromDot: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply Skill / Enemy Effects from Official Ninja Saga JSON Data
// ─────────────────────────────────────────────────────────────────────────────

function applySkillEffects(
  effects: RawSkillEffectDef[],
  caster: Combatant,
  target: Combatant,
  casterSide: 'player' | 'enemy',
  targetSide: 'player' | 'enemy',
  cooldowns: Record<string, number>,
  floats: FloatingNumber[],
  newlyAppliedSelf: Set<string>
): string[] {
  const notes: string[] = [];
  const waterPts = caster.points?.water ?? 0;
  const casterHealMult = 1.0 + waterPts * 0.01 + getStatusAmountSum(caster, 'plus_extra_hp') / 100;

  for (const eff of effects) {
    if (!eff || !eff.effect || eff.passive) continue;
    const chance = eff.chance ?? 100;
    if (chance < 100 && Math.random() * 100 >= chance) continue;

    const isSelfTarget = eff.target === 'self';
    const recipient = isSelfTarget ? caster : target;
    const recipientSide = isSelfTarget ? casterSide : targetSide;
    const effType: 'Buff' | 'Debuff' =
      eff.type === 'Buff' || eff.type === 'Debuff'
        ? eff.type
        : isSelfTarget
          ? 'Buff'
          : 'Debuff';

    const eid = eff.effect;
    const amount = Number(eff.amount ?? 0);
    const amountCp = eff.amount_cp !== undefined ? Number(eff.amount_cp) : undefined;
    const duration = Number(eff.duration ?? 0);
    const calcType = (eff.calc_type ?? '') as 'percent' | 'number' | '';

    // Debuff Resist blocks incoming enemy debuffs
    if (!isSelfTarget && effType === 'Debuff' && hasStatus(recipient, 'debuff_resist')) {
      floats.push({
        id: floatSeq++,
        target: recipientSide,
        text: 'RESISTED!',
        kind: 'buff',
      });
      notes.push(`${recipient.name} resisted ${eff.effect_name || eid}!`);
      continue;
    }

    // ── Instant Effects ──

    // Instant Heal
    if (eid === 'heal') {
      if (hasStatus(recipient, 'internal_injury')) {
        floats.push({ id: floatSeq++, target: recipientSide, text: 'HEAL BLOCKED!', kind: 'debuff' });
        notes.push(`${recipient.name}'s healing was blocked by Internal Injury!`);
      } else {
        const baseHeal =
          calcType === 'percent'
            ? Math.round((recipient.maxHp * Math.max(1, amount)) / 100)
            : Math.max(1, Math.round(amount));
        const healAmt = Math.round(baseHeal * casterHealMult);
        recipient.hp = Math.min(recipient.maxHp, recipient.hp + healAmt);
        floats.push({ id: floatSeq++, target: recipientSide, text: `+${healAmt} HP`, kind: 'heal' });
        notes.push(`+${healAmt} HP`);
      }
      continue;
    }

    // Purify / Debuff Clear
    if (eid === 'purify' || eid === 'debuff_clear') {
      const before = getStatuses(recipient).length;
      recipient.statuses = getStatuses(recipient).filter((s) => s.type !== 'Debuff');
      if (recipient.statuses.length < before || before === 0) {
        floats.push({ id: floatSeq++, target: recipientSide, text: 'PURIFY!', kind: 'buff' });
        notes.push(`Purified`);
      }
      continue;
    }

    // Disperse (remove enemy buffs)
    if (eid === 'disperse') {
      const before = getStatuses(recipient).length;
      recipient.statuses = getStatuses(recipient).filter((s) => s.type !== 'Buff' || s.noDisperse);
      if (recipient.statuses.length < before) {
        floats.push({ id: floatSeq++, target: recipientSide, text: 'DISPERSED!', kind: 'debuff' });
        notes.push(`Dispersed ${recipient.name}'s buffs`);
      }
      continue;
    }

    // Instant % HP Reduction
    if (eid === 'insta_reduce_max_hp' || eid === 'reduce_hp_as_damage') {
      const basePool = eff.reduce_type === 'CURRENT' ? recipient.hp : recipient.maxHp;
      const dmg = Math.max(1, Math.round((basePool * Math.max(1, amount)) / 100));
      recipient.hp = Math.max(0, recipient.hp - dmg);
      floats.push({ id: floatSeq++, target: recipientSide, text: `-${dmg}`, kind: 'damage' });
      notes.push(`-${dmg} HP`);
      continue;
    }

    // Instant CP Drain / Reduction
    if (
      eid === 'insta_reduce_max_cp' ||
      eid === 'current_cp_drain' ||
      eid === 'cp_drain' ||
      eid === 'instant_reduce_cp'
    ) {
      const basePool = eff.reduce_type === 'CURRENT' ? recipient.cp : recipient.maxCp;
      const loss =
        calcType === 'number'
          ? Math.max(1, Math.round(amount))
          : Math.max(1, Math.round((basePool * Math.max(1, amount)) / 100));
      recipient.cp = Math.max(0, recipient.cp - loss);
      floats.push({ id: floatSeq++, target: recipientSide, text: `-${loss} CP`, kind: 'debuff' });
      if (eid === 'current_cp_drain' || eid === 'cp_drain') {
        caster.cp = Math.min(caster.maxCp, caster.cp + loss);
        floats.push({ id: floatSeq++, target: casterSide, text: `+${loss} CP`, kind: 'cp' });
      }
      notes.push(`-${loss} CP`);
      continue;
    }

    // Drain HP (and optionally CP) to caster
    if (eid === 'drain_HpCp' || eid === 'current_hp_drain') {
      const hpPool = eff.reduce_type === 'CURRENT' ? recipient.hp : recipient.maxHp;
      const hpDrain = Math.max(1, Math.round((hpPool * Math.max(1, amount)) / 100));
      recipient.hp = Math.max(0, recipient.hp - hpDrain);
      floats.push({ id: floatSeq++, target: recipientSide, text: `-${hpDrain}`, kind: 'damage' });
      if (!hasStatus(caster, 'internal_injury')) {
        caster.hp = Math.min(caster.maxHp, caster.hp + hpDrain);
        floats.push({ id: floatSeq++, target: casterSide, text: `+${hpDrain} HP`, kind: 'heal' });
      }
      if (eid === 'drain_HpCp') {
        const cpDrain = Math.max(1, Math.round((recipient.maxCp * Math.max(1, amount)) / 100));
        recipient.cp = Math.max(0, recipient.cp - cpDrain);
        caster.cp = Math.min(caster.maxCp, caster.cp + cpDrain);
        floats.push({ id: floatSeq++, target: casterSide, text: `+${cpDrain} CP`, kind: 'cp' });
      }
      notes.push(`Drained ${hpDrain} HP`);
      continue;
    }

    // Rapid Cooldown (reduces all player cooldowns)
    if (eid === 'rapid_cooldown' && casterSide === 'player') {
      const dec = Math.max(1, Math.round(amount || 3));
      for (const k of Object.keys(cooldowns)) {
        if (cooldowns[k] > dec) cooldowns[k] -= dec;
        else delete cooldowns[k];
      }
      floats.push({ id: floatSeq++, target: casterSide, text: `CD -${dec}t`, kind: 'buff' });
      notes.push(`Cooldowns -${dec}t`);
      continue;
    }

    // Add Cooldown to Player
    if (eid === 'add_cooldown_player' && recipientSide === 'player') {
      const inc = Math.max(1, Math.round(amount || 1));
      for (const k of Object.keys(cooldowns)) {
        cooldowns[k] += inc;
      }
      floats.push({ id: floatSeq++, target: recipientSide, text: `CD +${inc}t`, kind: 'debuff' });
      notes.push(`Cooldowns +${inc}t`);
      continue;
    }

    // Consume all CP
    if (eid === 'insta_consume_all_cp') {
      caster.cp = 0;
      continue;
    }

    // ── Duration-based Buff / Debuff ──
    const turns = Math.max(1, duration || 2);
    const meta = getEffectMeta(eid, eff.effect_name);
    const status: StatusEffect = {
      id: eid,
      name: eff.effect_name || meta.name,
      shortCode: meta.shortCode,
      icon: meta.icon,
      type: effType,
      turns,
      amount,
      amountCp,
      amountProtection: eff.amount_protection,
      calcType,
      noDisperse: eff.no_disperse,
    };

    upsertStatus(recipient, status);
    if (isSelfTarget) {
      newlyAppliedSelf.add(eid);
    }

    floats.push({
      id: floatSeq++,
      target: recipientSide,
      text: `${status.name.toUpperCase()} (${turns}t)`,
      kind: effType === 'Buff' ? 'buff' : 'debuff',
    });
    notes.push(`${status.name} (${turns}t)`);
  }

  return notes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reactive On-Hit Effects (Sleep Break, Bloodfeed, Lightning Armor, Fire Wall, Reactive Force)
// ─────────────────────────────────────────────────────────────────────────────

function applyOnHitReactions(
  finalDmg: number,
  attacker: Combatant,
  defender: Combatant,
  attackerSide: 'player' | 'enemy',
  defenderSide: 'player' | 'enemy',
  floats: FloatingNumber[]
): void {
  if (finalDmg <= 0) return;

  // 1) Sleep breaks on damage!
  if (removeStatus(defender, 'sleep')) {
    floats.push({ id: floatSeq++, target: defenderSide, text: 'WOKE UP!', kind: 'buff' });
  }

  // 2) Attacker Bloodfeed (lifesteal)
  if (hasStatus(attacker, 'bloodfeed') && !hasStatus(attacker, 'internal_injury')) {
    const pct = getStatusAmountSum(attacker, 'bloodfeed');
    const healAmt = Math.max(1, Math.round((finalDmg * pct) / 100));
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + healAmt);
    floats.push({ id: floatSeq++, target: attackerSide, text: `+${healAmt} HP`, kind: 'heal' });
  }

  // 3) Defender Lightning Armor (reflects % damage)
  if (hasStatus(defender, 'lightning_armor')) {
    const pct = getStatusAmountSum(defender, 'lightning_armor');
    const refDmg = Math.max(1, Math.round((finalDmg * pct) / 100));
    attacker.hp = Math.max(0, attacker.hp - refDmg);
    floats.push({ id: floatSeq++, target: defenderSide, text: 'LIGHTNING ARMOR', kind: 'buff' });
    floats.push({ id: floatSeq++, target: attackerSide, text: `-${refDmg}`, kind: 'damage' });
  }

  // 4) Defender Fire Wall (inflicts Burn on attacker)
  if (hasStatus(defender, 'fire_wall') && !hasStatus(attacker, 'debuff_resist')) {
    const fw = getStatuses(defender).find((s) => s.id === 'fire_wall');
    const meta = getEffectMeta('burn');
    upsertStatus(attacker, {
      id: 'burn',
      name: meta.name,
      shortCode: meta.shortCode,
      icon: meta.icon,
      type: 'Debuff',
      turns: 2,
      amount: fw?.amount || 5,
      calcType: 'percent',
    });
    floats.push({ id: floatSeq++, target: attackerSide, text: 'FIRE WALL BURN!', kind: 'debuff' });
  }

  // 5) Defender dec_cp_attacker (drains attacker CP)
  if (hasStatus(defender, 'dec_cp_attacker')) {
    const pct = getStatusAmountSum(defender, 'dec_cp_attacker');
    const cpLoss = Math.max(1, Math.round((attacker.maxCp * pct) / 100));
    attacker.cp = Math.max(0, attacker.cp - cpLoss);
    floats.push({ id: floatSeq++, target: attackerSide, text: `-${cpLoss} CP`, kind: 'debuff' });
  }

  // 6) Reactive Force: Player Earth passive (0.4%/pt) OR Enemy native reactive% from enemy.json (30% reflect)
  const reactiveRate = defender.reactiveChance ?? ((defender.points?.earth ?? 0) * 0.004);
  if (reactiveRate > 0 && Math.random() < reactiveRate) {
    const reflectDmg = Math.max(1, Math.round(finalDmg * 0.30));
    attacker.hp = Math.max(0, attacker.hp - reflectDmg);
    floats.push({ id: floatSeq++, target: defenderSide, text: 'REACTIVE FORCE', kind: 'buff' });
    floats.push({ id: floatSeq++, target: attackerSide, text: `-${reflectDmg}`, kind: 'damage' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Action Execution
// ─────────────────────────────────────────────────────────────────────────────

export function executePlayerAction(
  player: Combatant,
  enemy: Combatant,
  cooldowns: Record<string, number>,
  action: { type: 'attack' } | { type: 'charge' } | { type: 'skill'; skill: SkillDef },
  skillEffects?: RawSkillEffectDef[]
): TurnOutcome {
  const nextPlayer: Combatant = { ...player, statuses: [...getStatuses(player)] };
  const nextEnemy: Combatant = { ...enemy, statuses: [...getStatuses(enemy)] };
  const nextCd = tickCooldowns(cooldowns);
  const floats: FloatingNumber[] = [];
  const newlyAppliedSelf = new Set<string>();

  const p = player.points ?? { wind: 0, fire: 0, lightning: 0, water: 0, earth: 0, free: 0 };
  const isDismantled = hasStatus(nextPlayer, 'dismantle');
  const wpnDmg = isDismantled ? 0 : Math.max(0, player.weaponDamage ?? 0);

  // Fire Secondary Effects: +0.4% all damage & 0.4% chance for Combustion (+30% all damage for 1 turn)
  const fireAllDmgMult = 1.0 + (p.fire || 0) * 0.004;
  const combustionChance = (p.fire || 0) * 0.004;
  if (Math.random() < combustionChance) {
    const meta = getEffectMeta('combustion');
    upsertStatus(nextPlayer, {
      id: 'combustion',
      name: meta.name,
      shortCode: meta.shortCode,
      icon: meta.icon,
      type: 'Buff',
      turns: 1,
      amount: 30,
      calcType: 'percent',
    });
    floats.push({ id: floatSeq++, target: 'player', text: 'COMBUSTION (+30%)', kind: 'buff' });
  }

  // Thunder Secondary Effect: +0.8% critical strike damage bonus per point
  const critMultiplier = 1.50 + (p.lightning || 0) * 0.008;

  // ── CHARGE ACTION ──
  if (action.type === 'charge') {
    const gained = Math.max(25, Math.round(nextPlayer.maxCp * 0.25));
    nextPlayer.cp = Math.min(nextPlayer.maxCp, nextPlayer.cp + gained);
    floats.push({ id: floatSeq++, target: 'player', text: `+${gained} CP`, kind: 'cp' });
    tickDownStatuses(nextPlayer);
    return {
      player: nextPlayer,
      enemy: nextEnemy,
      cooldowns: nextCd,
      floats,
      log: `${nextPlayer.name} focused chakra (+${gained} CP).`,
    };
  }

  // ── WEAPON ATTACK ──
  if (action.type === 'attack') {
    // 1. Restore 5% CP whether the attack hits or misses
    const cpRestore = Math.max(1, Math.round(nextPlayer.maxCp * 0.05));
    nextPlayer.cp = Math.min(nextPlayer.maxCp, nextPlayer.cp + cpRestore);
    floats.push({ id: floatSeq++, target: 'player', text: `+${cpRestore} CP`, kind: 'cp' });

    const outDmgMult = getOutgoingDamageMultiplier(nextPlayer);
    removeStatus(nextPlayer, 'stealth');

    // 2. Check enemy dodge
    const enemyDodge = getEffectiveDodgeChance(nextPlayer, nextEnemy);
    if (Math.random() < enemyDodge) {
      floats.push({ id: floatSeq++, target: 'enemy', text: 'DODGE!', kind: 'dodge' });
      tickDownStatuses(nextPlayer);
      return {
        player: nextPlayer,
        enemy: nextEnemy,
        cooldowns: nextCd,
        floats,
        log: `${nextEnemy.name} dodged ${nextPlayer.name}'s weapon attack!`,
        wasDodged: true,
      };
    }

    // 3. Listed weapon damage with -20% to +20% variance
    const listedDmg = Math.max(1, wpnDmg > 0 ? wpnDmg : 5);
    const variance = 0.80 + Math.random() * 0.40;
    const isCrit = Math.random() < getEffectiveCritChance(nextPlayer);
    const critBonus = isCrit ? critMultiplier : 1.0;

    const preDefenseDmg = Math.max(
      1,
      Math.round(listedDmg * variance * fireAllDmgMult * outDmgMult * critBonus)
    );
    const finalDmg = applyIncomingDamageModifiers(preDefenseDmg, nextEnemy, 'enemy', floats);

    nextEnemy.hp = Math.max(0, nextEnemy.hp - finalDmg);
    floats.push({
      id: floatSeq++,
      target: 'enemy',
      text: isCrit ? `CRIT -${finalDmg}!` : `-${finalDmg}`,
      kind: isCrit ? 'crit' : 'damage',
    });

    applyOnHitReactions(finalDmg, nextPlayer, nextEnemy, 'player', 'enemy', floats);
    tickDownStatuses(nextPlayer);

    return {
      player: nextPlayer,
      enemy: nextEnemy,
      cooldowns: nextCd,
      floats,
      log: `${nextPlayer.name} attacked with weapon for ${finalDmg} dmg${isCrit ? ' (CRIT!)' : ''}.`,
      didCrit: isCrit,
    };
  }

  // ── SKILL / NINJUTSU ATTACK ──
  const sk = action.skill;
  const cost = getEffectiveSkillCpCost(nextPlayer, sk.cp_cost || 0);
  if (nextPlayer.cp < cost) {
    return {
      player: nextPlayer,
      enemy: nextEnemy,
      cooldowns,
      floats: [],
      log: `Not enough CP for ${sk.name}!`,
    };
  }
  nextPlayer.cp -= cost;
  if (sk.cooldown > 0) {
    nextCd[sk.id] = sk.cooldown;
  }

  const label = sk.name;
  const skillSwfToPlay = `${sk.id}.swf`;
  const effects = skillEffects ?? [];
  const hasExplicitEffects = effects.length > 0;
  const dealsDamage = (sk.damage ?? 0) > 0;

  // Fallback heuristic ONLY if skill-effect.json has no entry for this skill
  if (!hasExplicitEffects && !dealsDamage) {
    const isHeal =
      (sk.description && /heal|recover/i.test(sk.description)) ||
      (sk.name && /heal/i.test(sk.name));
    if (isHeal) {
      if (hasStatus(nextPlayer, 'internal_injury')) {
        floats.push({ id: floatSeq++, target: 'player', text: 'HEAL BLOCKED!', kind: 'debuff' });
        tickDownStatuses(nextPlayer);
        return {
          player: nextPlayer,
          enemy: nextEnemy,
          cooldowns: nextCd,
          floats,
          log: `${nextPlayer.name}'s ${label} was blocked by Internal Injury!`,
          skillSwfToPlay,
        };
      }
      const waterHealMult = 1.0 + (p.water || 0) * 0.01;
      const healAmount = Math.round(nextPlayer.maxHp * 0.25 * waterHealMult);
      nextPlayer.hp = Math.min(nextPlayer.maxHp, nextPlayer.hp + healAmount);
      floats.push({ id: floatSeq++, target: 'player', text: `+${healAmount} HP`, kind: 'heal' });
      tickDownStatuses(nextPlayer);
      return {
        player: nextPlayer,
        enemy: nextEnemy,
        cooldowns: nextCd,
        floats,
        log: `${nextPlayer.name} cast ${label} and recovered ${healAmount} HP.`,
        skillSwfToPlay,
      };
    }
  }

  // Self-only buff/heal skill (no damage & all effects target 'self')
  const targetsEnemy = dealsDamage || effects.some((e) => e.target !== 'self');
  if (!targetsEnemy && hasExplicitEffects) {
    const notes = applySkillEffects(
      effects,
      nextPlayer,
      nextEnemy,
      'player',
      'enemy',
      nextCd,
      floats,
      newlyAppliedSelf
    );
    tickDownStatuses(nextPlayer, newlyAppliedSelf);
    return {
      player: nextPlayer,
      enemy: nextEnemy,
      cooldowns: nextCd,
      floats,
      log: `${nextPlayer.name} cast ${label}${notes.length ? ` (${notes.join(', ')})` : ''}.`,
      skillSwfToPlay,
    };
  }

  // Offensive or Enemy-debuff Ninjutsu
  const outDmgMult = getOutgoingDamageMultiplier(nextPlayer);
  removeStatus(nextPlayer, 'stealth');

  // Check enemy dodge (offensive skills can be dodged if attacker is Blinded or enemy has Flexible/Stealth)
  const enemyDodge = getEffectiveDodgeChance(nextPlayer, nextEnemy);
  if (Math.random() < enemyDodge) {
    // Self-buffs on a skill still apply even if enemy dodges
    const selfEffects = effects.filter((e) => e.target === 'self');
    if (selfEffects.length > 0) {
      applySkillEffects(selfEffects, nextPlayer, nextEnemy, 'player', 'enemy', nextCd, floats, newlyAppliedSelf);
    }
    floats.push({ id: floatSeq++, target: 'enemy', text: 'DODGE!', kind: 'dodge' });
    tickDownStatuses(nextPlayer, newlyAppliedSelf);
    return {
      player: nextPlayer,
      enemy: nextEnemy,
      cooldowns: nextCd,
      floats,
      log: `${nextEnemy.name} dodged ${nextPlayer.name}'s ${label}!`,
      skillSwfToPlay,
    };
  }

  let finalDmg = 0;
  let isCrit = false;

  if (dealsDamage || !hasExplicitEffects) {
    const skBase = dealsDamage ? sk.damage : 20;
    const variance = 0.80 + Math.random() * 0.40;

    // Matching Element Bonus: +1% extra damage to Ninjutsu of matching element
    let matchingElemMult = 1.0;
    const skType = String(sk.type ?? '');
    if (skType === '1') matchingElemMult += (p.wind || 0) * 0.01;
    else if (skType === '2') matchingElemMult += (p.fire || 0) * 0.01;
    else if (skType === '3') matchingElemMult += (p.lightning || 0) * 0.01;
    else if (skType === '4') matchingElemMult += (p.earth || 0) * 0.01;
    else if (skType === '5') matchingElemMult += (p.water || 0) * 0.01;

    isCrit = Math.random() < getEffectiveCritChance(nextPlayer);
    const critBonus = isCrit ? critMultiplier : 1.0;

    const preDefenseDmg = Math.max(
      1,
      Math.round(skBase * variance * matchingElemMult * fireAllDmgMult * outDmgMult * critBonus)
    );
    finalDmg = applyIncomingDamageModifiers(preDefenseDmg, nextEnemy, 'enemy', floats);
    nextEnemy.hp = Math.max(0, nextEnemy.hp - finalDmg);
    floats.push({
      id: floatSeq++,
      target: 'enemy',
      text: isCrit ? `CRIT -${finalDmg}!` : `-${finalDmg}`,
      kind: isCrit ? 'crit' : 'damage',
    });

    applyOnHitReactions(finalDmg, nextPlayer, nextEnemy, 'player', 'enemy', floats);
  }

  // Apply all official Ninja Saga Buffs & Debuffs from skill-effect.json
  const effectNotes = hasExplicitEffects
    ? applySkillEffects(
        effects,
        nextPlayer,
        nextEnemy,
        'player',
        'enemy',
        nextCd,
        floats,
        newlyAppliedSelf
      )
    : [];

  tickDownStatuses(nextPlayer, newlyAppliedSelf);

  const dmgText = finalDmg > 0 ? ` for ${finalDmg} dmg${isCrit ? ' (CRIT!)' : ''}` : '';
  const effText = effectNotes.length > 0 ? ` [${effectNotes.join(', ')}]` : '';

  return {
    player: nextPlayer,
    enemy: nextEnemy,
    cooldowns: nextCd,
    floats,
    log: `${nextPlayer.name} cast ${label}${dmgText}${effText}.`,
    skillSwfToPlay,
    didCrit: isCrit,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enemy Turn Execution (with Official Enemy Attack Effects from enemy.json)
// ─────────────────────────────────────────────────────────────────────────────

export function executeEnemyTurn(
  player: Combatant,
  enemy: Combatant,
  cooldowns: Record<string, number>,
  enemyEffects?: RawSkillEffectDef[],
  chosenAttack?: EnemyAttackSpec
): TurnOutcome {
  const nextPlayer: Combatant = { ...player, statuses: [...getStatuses(player)] };
  const tickedAtkCds: Record<number, number> = {};
  for (const [k, v] of Object.entries(enemy.attackCooldowns ?? {})) {
    if (v > 1) tickedAtkCds[Number(k)] = v - 1;
  }
  if (chosenAttack?.index !== undefined && (chosenAttack.cooldown ?? 0) > 0) {
    tickedAtkCds[chosenAttack.index] = chosenAttack.cooldown!;
  }

  const nextEnemy: Combatant = {
    ...enemy,
    statuses: [...getStatuses(enemy)],
    attackCooldowns: tickedAtkCds,
  };
  const nextCd = { ...cooldowns };
  const floats: FloatingNumber[] = [];
  const newlyAppliedSelf = new Set<string>();
  const effects = chosenAttack?.effects ?? enemyEffects ?? [];

  // Enemy native Combustion% from enemy.json (+30% damage)
  const enemyCombRate = nextEnemy.combustionChance ?? 0;
  if (enemyCombRate > 0 && Math.random() < enemyCombRate) {
    const meta = getEffectMeta('combustion');
    upsertStatus(nextEnemy, {
      id: 'combustion',
      name: meta.name,
      shortCode: meta.shortCode,
      icon: meta.icon,
      type: 'Buff',
      turns: 1,
      amount: 30,
      calcType: 'percent',
    });
    floats.push({ id: floatSeq++, target: 'enemy', text: 'COMBUSTION (+30%)', kind: 'buff' });
  }

  // Pure self-buff / heal enemy move (e.g. dmg === 0 and all effects target self)
  const rawAtkDmg = chosenAttack?.dmg;
  const isPureSelfMove =
    rawAtkDmg === 0 && effects.length > 0 && effects.every((e) => e.target === 'self');
  if (isPureSelfMove) {
    const notes = applySkillEffects(
      effects,
      nextEnemy,
      nextPlayer,
      'enemy',
      'player',
      nextCd,
      floats,
      newlyAppliedSelf
    );
    tickDownStatuses(nextEnemy, newlyAppliedSelf);
    return {
      player: nextPlayer,
      enemy: nextEnemy,
      cooldowns: nextCd,
      floats,
      log: `${nextEnemy.name} used a technique${notes.length ? ` [${notes.join(', ')}]` : ''}.`,
    };
  }

  const outDmgMult = getOutgoingDamageMultiplier(nextEnemy);
  removeStatus(nextEnemy, 'stealth');

  // Check player dodge (Wind +0.4%/pt + Flexible/Attention/Stealth - Enemy Accuracy% + Enemy Blind/Darkness)
  const playerDodge = getEffectiveDodgeChance(nextEnemy, nextPlayer);
  if (Math.random() < playerDodge) {
    const selfEffs = effects.filter((e) => e.target === 'self');
    if (selfEffs.length > 0) {
      applySkillEffects(selfEffs, nextEnemy, nextPlayer, 'enemy', 'player', nextCd, floats, newlyAppliedSelf);
    }
    floats.push({ id: floatSeq++, target: 'player', text: 'DODGE!', kind: 'dodge' });
    tickDownStatuses(nextEnemy, newlyAppliedSelf);
    return {
      player: nextPlayer,
      enemy: nextEnemy,
      cooldowns: nextCd,
      floats,
      log: `${nextPlayer.name} dodged ${nextEnemy.name}'s attack!`,
    };
  }

  // Canonical Ninja Saga Enemy Attack Damage:
  // - If enemy.json attack dmg > 10: exact listed flat boss damage (e.g. Tengu 170..500, Orochi 230..440)
  // - If 0 < dmg <= 10: multiplier on enemy baseDamage (e.g. 1x, 1.5x, 2x, 3x)
  // - If dmg === 0: 0 damage (pure debuff move)
  let finalDmg = 0;
  let isCrit = false;

  if (rawAtkDmg !== 0) {
    const baseAtk =
      rawAtkDmg !== undefined && rawAtkDmg > 10
        ? rawAtkDmg
        : enemy.baseDamage * (rawAtkDmg && rawAtkDmg > 0 ? rawAtkDmg : 1);
    const variance = 0.80 + Math.random() * 0.40;
    isCrit = Math.random() < getEffectiveCritChance(nextEnemy);
    const critBonus = isCrit ? 1.5 : 1.0;
    const preDefenseDmg = Math.max(1, Math.round(baseAtk * variance * outDmgMult * critBonus));
    finalDmg = applyIncomingDamageModifiers(preDefenseDmg, nextPlayer, 'player', floats);

    nextPlayer.hp = Math.max(0, nextPlayer.hp - finalDmg);
    floats.push({
      id: floatSeq++,
      target: 'player',
      text: isCrit ? `CRIT -${finalDmg}!` : `-${finalDmg}`,
      kind: isCrit ? 'crit' : 'damage',
    });

    applyOnHitReactions(finalDmg, nextEnemy, nextPlayer, 'enemy', 'player', floats);
  }

  // Apply official Enemy Attack Buffs & Debuffs
  const effectNotes =
    effects.length > 0
      ? applySkillEffects(
          effects,
          nextEnemy,
          nextPlayer,
          'enemy',
          'player',
          nextCd,
          floats,
          newlyAppliedSelf
        )
      : [];

  tickDownStatuses(nextEnemy, newlyAppliedSelf);

  const dmgText = finalDmg > 0 ? ` for ${finalDmg} dmg${isCrit ? ' (CRIT!)' : ''}` : '';
  const effText = effectNotes.length > 0 ? ` [${effectNotes.join(', ')}]` : '';

  return {
    player: nextPlayer,
    enemy: nextEnemy,
    cooldowns: nextCd,
    floats,
    log: `${nextEnemy.name} struck ${nextPlayer.name}${dmgText}${effText}.`,
    didCrit: isCrit,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ninja Horizon Extensions: Element Meta, AoE Skills, Auto-Battle, Consumables, Pet & Flee
// ─────────────────────────────────────────────────────────────────────────────

export function getSkillElementMeta(type?: string): SkillElementMeta {
  switch (String(type ?? '')) {
    case '1':
      return { label: 'Wind', icon: '🌪️', bg: '#15803D', border: '#4ADE80' };
    case '2':
      return { label: 'Fire', icon: '🔥', bg: '#B91C1C', border: '#F87171' };
    case '3':
      return { label: 'Lightning', icon: '⚡', bg: '#A16207', border: '#FACC15' };
    case '4':
      return { label: 'Earth', icon: '🪨', bg: '#78350F', border: '#D97706' };
    case '5':
      return { label: 'Water', icon: '💧', bg: '#1D4ED8', border: '#60A5FA' };
    case '6':
      return { label: 'Taijutsu', icon: '👊', bg: '#9A3412', border: '#FB923C' };
    case '7':
      return { label: 'Genjutsu', icon: '👁️', bg: '#6D28D9', border: '#C084FC' };
    default:
      return { label: 'Jutsu', icon: '✦', bg: '#5B21B6', border: '#A78BFA' };
  }
}

export function isSkillAoE(skill: SkillDef): boolean {
  if (String(skill.target ?? '').toLowerCase() === 'all') return true;
  if (skill.description && /all enemies|all targets|every enemy/i.test(skill.description)) {
    return true;
  }
  return false;
}

export function executePlayerActionMulti(
  player: Combatant,
  enemies: Combatant[],
  targetIdx: number,
  cooldowns: Record<string, number>,
  action: { type: 'attack' } | { type: 'charge' } | { type: 'skill'; skill: SkillDef },
  skillEffects?: RawSkillEffectDef[]
): MultiTurnOutcome {
  // Single-target path (attack, charge, or single/self skill)
  if (action.type !== 'skill' || !isSkillAoE(action.skill)) {
    const safeIdx =
      enemies[targetIdx] && enemies[targetIdx].hp > 0
        ? targetIdx
        : Math.max(0, enemies.findIndex((e) => e.hp > 0));
    const targetEnemy = enemies[safeIdx];
    const single = executePlayerAction(player, targetEnemy, cooldowns, action, skillEffects);
    const taggedFloats = single.floats.map((f) =>
      f.target === 'enemy' ? { ...f, targetSlot: safeIdx } : f
    );
    return {
      player: single.player,
      enemies: enemies.map((e, i) => (i === safeIdx ? single.enemy : e)),
      cooldowns: single.cooldowns,
      floats: taggedFloats,
      log: single.log,
      skillSwfToPlay: single.skillSwfToPlay,
      didCrit: single.didCrit,
      wasDodged: single.wasDodged,
      isAoE: false,
    };
  }

  // AoE Skill Path (TARGET_ENEMY_ALL — hits all alive enemies!)
  const sk = action.skill;
  const cost = getEffectiveSkillCpCost(player, sk.cp_cost || 0);
  if (player.cp < cost) {
    return {
      player: { ...player },
      enemies: enemies.map((e) => ({ ...e })),
      cooldowns,
      floats: [],
      log: `Not enough CP for ${sk.name}!`,
      isAoE: true,
    };
  }

  const aliveIndices = enemies
    .map((e, i) => (e.hp > 0 ? i : -1))
    .filter((i) => i !== -1);

  if (aliveIndices.length === 0) {
    return {
      player: { ...player },
      enemies: enemies.map((e) => ({ ...e })),
      cooldowns,
      floats: [],
      log: `No enemies remaining!`,
      isAoE: true,
    };
  }

  let curPlayer: Combatant = { ...player, statuses: [...getStatuses(player)] };
  const nextEnemies = enemies.map((e) => ({ ...e, statuses: [...getStatuses(e)] }));
  const allFloats: FloatingNumber[] = [];
  let anyCrit = false;
  let totalHits = 0;
  let totalDmg = 0;

  // Run primary hit on first alive enemy (spends CP, ticks cooldowns & self-statuses once)
  const firstIdx = aliveIndices[0];
  const primaryOut = executePlayerAction(curPlayer, nextEnemies[firstIdx], cooldowns, action, skillEffects);
  curPlayer = primaryOut.player;
  nextEnemies[firstIdx] = primaryOut.enemy;
  const finalCd = primaryOut.cooldowns;
  if (primaryOut.didCrit) anyCrit = true;
  if (!primaryOut.wasDodged) totalHits++;
  for (const f of primaryOut.floats) {
    if (f.target === 'enemy') {
      allFloats.push({ ...f, targetSlot: firstIdx });
      const m = f.text.match(/-(\d+)/);
      if (m) totalDmg += Number(m[1]);
    } else {
      allFloats.push(f);
    }
  }

  // Apply AoE strike to remaining alive enemies (without re-spending CP or re-ticking cooldowns)
  const p = curPlayer.points ?? { wind: 0, fire: 0, lightning: 0, water: 0, earth: 0, free: 0 };
  const fireAllDmgMult = 1.0 + (p.fire || 0) * 0.004;
  const critMultiplier = 1.50 + (p.lightning || 0) * 0.008;
  const outDmgMult = getOutgoingDamageMultiplier(curPlayer);
  const enemyEffects = (skillEffects ?? []).filter((e) => e.target !== 'self');
  const dummySelf = new Set<string>();

  for (let k = 1; k < aliveIndices.length; k++) {
    const idx = aliveIndices[k];
    const target = nextEnemies[idx];
    const dodge = getEffectiveDodgeChance(curPlayer, target);
    if (Math.random() < dodge) {
      allFloats.push({ id: floatSeq++, target: 'enemy', targetSlot: idx, text: 'DODGE!', kind: 'dodge' });
      continue;
    }
    totalHits++;
    if ((sk.damage ?? 0) > 0 || enemyEffects.length === 0) {
      const skBase = (sk.damage ?? 0) > 0 ? sk.damage : 20;
      const variance = 0.80 + Math.random() * 0.40;
      let matchingElemMult = 1.0;
      const skType = String(sk.type ?? '');
      if (skType === '1') matchingElemMult += (p.wind || 0) * 0.01;
      else if (skType === '2') matchingElemMult += (p.fire || 0) * 0.01;
      else if (skType === '3') matchingElemMult += (p.lightning || 0) * 0.01;
      else if (skType === '4') matchingElemMult += (p.earth || 0) * 0.01;
      else if (skType === '5') matchingElemMult += (p.water || 0) * 0.01;

      const isCrit = Math.random() < getEffectiveCritChance(curPlayer);
      if (isCrit) anyCrit = true;
      const critBonus = isCrit ? critMultiplier : 1.0;
      const preDef = Math.max(
        1,
        Math.round(skBase * variance * matchingElemMult * fireAllDmgMult * outDmgMult * critBonus)
      );
      const subFloats: FloatingNumber[] = [];
      const dmg = applyIncomingDamageModifiers(preDef, target, 'enemy', subFloats);
      target.hp = Math.max(0, target.hp - dmg);
      totalDmg += dmg;
      subFloats.push({
        id: floatSeq++,
        target: 'enemy',
        text: isCrit ? `CRIT -${dmg}!` : `-${dmg}`,
        kind: isCrit ? 'crit' : 'damage',
      });
      applyOnHitReactions(dmg, curPlayer, target, 'player', 'enemy', subFloats);
      for (const f of subFloats) {
        allFloats.push(f.target === 'enemy' ? { ...f, targetSlot: idx } : f);
      }
    }
    if (enemyEffects.length > 0) {
      const effFloats: FloatingNumber[] = [];
      applySkillEffects(enemyEffects, curPlayer, target, 'player', 'enemy', finalCd, effFloats, dummySelf);
      for (const f of effFloats) {
        allFloats.push(f.target === 'enemy' ? { ...f, targetSlot: idx } : f);
      }
    }
  }

  return {
    player: curPlayer,
    enemies: nextEnemies,
    cooldowns: finalCd,
    floats: allFloats,
    log: `${curPlayer.name} cast AoE ${sk.name} hitting ${totalHits}/${aliveIndices.length} enemies (${totalDmg} total dmg)!`,
    skillSwfToPlay: `${sk.id}.swf`,
    didCrit: anyCrit,
    isAoE: true,
  };
}

export function chooseAutoBattleAction(
  player: Combatant,
  enemies: Combatant[],
  skills: SkillDef[],
  cooldowns: Record<string, number>,
  skillEffectsById: Record<string, RawSkillEffectDef[]>
): { type: 'attack' } | { type: 'charge' } | { type: 'skill'; skill: SkillDef } {
  const sealed = isSkillsRestricted(player);
  const chargeLocked = isChargeDisabled(player);
  const aliveCount = enemies.filter((e) => e.hp > 0).length;

  const readySkills = sealed
    ? []
    : skills.filter((sk) => {
        const cd = cooldowns[sk.id] ?? 0;
        const cost = getEffectiveSkillCpCost(player, sk.cp_cost || 0);
        return cd <= 0 && player.cp >= cost;
      });

  // 1) Low HP? Prioritize a healing skill if available and not blocked by Internal Injury
  if (player.hp / Math.max(1, player.maxHp) < 0.5 && !hasStatus(player, 'internal_injury')) {
    const healSkill = readySkills.find((sk) => {
      const effs = skillEffectsById[sk.id] ?? [];
      return (
        effs.some((e) => e.effect === 'heal' || e.effect === 'regenHP' || e.effect === 'regeneration') ||
        /heal|recover/i.test(sk.name + ' ' + sk.description)
      );
    });
    if (healSkill) return { type: 'skill', skill: healSkill };
  }

  // 2) Low CP (< 25%) and no affordable ready skill -> Charge (Ninja Horizon Normal Auto rule)
  if (!chargeLocked && player.cp < player.maxCp * 0.25 && readySkills.length === 0) {
    return { type: 'charge' };
  }

  // 3) Pick best ready offensive skill (prefer AoE when 2+ enemies alive, else highest damage)
  if (readySkills.length > 0) {
    const scored = [...readySkills].sort((a, b) => {
      const aAoE = aliveCount >= 2 && isSkillAoE(a) ? 1.65 : 1.0;
      const bAoE = aliveCount >= 2 && isSkillAoE(b) ? 1.65 : 1.0;
      const aScore = (a.damage || 30) * aAoE;
      const bScore = (b.damage || 30) * bAoE;
      return bScore - aScore;
    });
    return { type: 'skill', skill: scored[0] };
  }

  // 4) Fallback to Weapon Attack (also restores +5% CP)
  return { type: 'attack' };
}

export function executeConsumableAction(
  player: Combatant,
  cooldowns: Record<string, number>,
  itemId: BattleConsumable['id']
): {
  player: Combatant;
  cooldowns: Record<string, number>;
  floats: FloatingNumber[];
  log: string;
} {
  const nextPlayer: Combatant = { ...player, statuses: [...getStatuses(player)] };
  const nextCd = tickCooldowns(cooldowns);
  const floats: FloatingNumber[] = [];
  let log = '';

  if (itemId === 'hp_scroll') {
    if (hasStatus(nextPlayer, 'internal_injury')) {
      floats.push({ id: floatSeq++, target: 'player', text: 'HEAL BLOCKED!', kind: 'debuff' });
      log = `${nextPlayer.name} used Healing Scroll, but Internal Injury blocked healing!`;
    } else {
      const heal = Math.max(40, Math.round(nextPlayer.maxHp * 0.35));
      nextPlayer.hp = Math.min(nextPlayer.maxHp, nextPlayer.hp + heal);
      floats.push({ id: floatSeq++, target: 'player', text: `+${heal} HP`, kind: 'heal' });
      log = `${nextPlayer.name} used Healing Scroll (+${heal} HP).`;
    }
  } else if (itemId === 'cp_scroll') {
    const gain = Math.max(40, Math.round(nextPlayer.maxCp * 0.35));
    nextPlayer.cp = Math.min(nextPlayer.maxCp, nextPlayer.cp + gain);
    floats.push({ id: floatSeq++, target: 'player', text: `+${gain} CP`, kind: 'cp' });
    log = `${nextPlayer.name} used Chakra Scroll (+${gain} CP).`;
  } else {
    nextPlayer.statuses = nextPlayer.statuses.filter((s) => s.type !== 'Debuff');
    floats.push({ id: floatSeq++, target: 'player', text: 'PURIFY!', kind: 'buff' });
    log = `${nextPlayer.name} used Antidote Pill and cleared all debuffs!`;
  }

  tickDownStatuses(nextPlayer);
  return { player: nextPlayer, cooldowns: nextCd, floats, log };
}

export function buildPetCombatant(pet: PetJsonDef, ownerLevel: number): Combatant {
  const lvl = Math.max(1, pet.level || ownerLevel);
  return {
    id: 'pet',
    name: pet.name || 'Ninja Pet',
    level: lvl,
    hp: 9999,
    maxHp: 9999,
    cp: 9999,
    maxCp: 9999,
    agility: Math.max(6, pet.agility || Math.round(8 + lvl * 0.9)),
    baseDamage: Math.max(10, Math.round(10 + lvl * 3.2)),
    critChance: Math.max(0.05, Math.min(0.5, (pet.critical ?? 5) / 100)),
    dodgeChance: Math.max(0.05, Math.min(0.5, (pet.dodge ?? 5) / 100)),
    attackCooldowns: {},
    statuses: [],
  };
}

export function executePetTurn(
  pet: Combatant,
  targetEnemy: Combatant,
  targetSlot: number,
  petDef?: PetJsonDef
): {
  pet: Combatant;
  enemy: Combatant;
  floats: FloatingNumber[];
  log: string;
  didCrit: boolean;
} {
  const nextEnemy: Combatant = { ...targetEnemy, statuses: [...getStatuses(targetEnemy)] };
  const tickedCds: Record<number, number> = {};
  for (const [k, v] of Object.entries(pet.attackCooldowns ?? {})) {
    if (v > 1) tickedCds[Number(k)] = v - 1;
  }

  const unlockedAtks = (petDef?.attacks ?? [])
    .map((a, idx) => ({ ...a, idx }))
    .filter((a) => (a.level ?? 1) <= pet.level);
  const readyAtks = unlockedAtks.filter((a) => !((pet.attackCooldowns?.[a.idx] ?? 0) > 0));
  const chosen = readyAtks.length > 0 ? readyAtks[readyAtks.length - 1] : unlockedAtks[0];

  if (chosen && (chosen.cooldown ?? 0) > 0) {
    tickedCds[chosen.idx] = chosen.cooldown;
  }

  const nextPet: Combatant = { ...pet, attackCooldowns: tickedCds };
  const floats: FloatingNumber[] = [];

  const enemyDodge = getEffectiveDodgeChance(nextPet, nextEnemy);
  if (Math.random() < enemyDodge) {
    floats.push({ id: floatSeq++, target: 'enemy', targetSlot, text: 'DODGE!', kind: 'dodge' });
    return {
      pet: nextPet,
      enemy: nextEnemy,
      floats,
      log: `${nextEnemy.name} dodged ${nextPet.name}'s ${chosen?.name || 'attack'}!`,
      didCrit: false,
    };
  }

  const base = chosen?.dmg && chosen.dmg > 10 ? chosen.dmg : nextPet.baseDamage * (chosen?.dmg || 1);
  const variance = 0.85 + Math.random() * 0.30;
  const isCrit = Math.random() < getEffectiveCritChance(nextPet);
  const rawDmg = Math.max(1, Math.round(base * variance * (isCrit ? 1.5 : 1.0)));
  const finalDmg = applyIncomingDamageModifiers(rawDmg, nextEnemy, 'enemy', floats);
  nextEnemy.hp = Math.max(0, nextEnemy.hp - finalDmg);
  floats.push({
    id: floatSeq++,
    target: 'enemy',
    targetSlot,
    text: isCrit ? `🐾 CRIT -${finalDmg}!` : `🐾 -${finalDmg}`,
    kind: isCrit ? 'crit' : 'damage',
  });

  return {
    pet: nextPet,
    enemy: nextEnemy,
    floats,
    log: `🐾 ${nextPet.name} used ${chosen?.name || 'Claw Strike'} on ${nextEnemy.name} for ${finalDmg} dmg${isCrit ? ' (CRIT!)' : ''}!`,
    didCrit: isCrit,
  };
}

export function attemptFlee(
  player: Combatant,
  enemies: Combatant[]
): { escaped: boolean; chancePct: number; log: string } {
  const alive = enemies.filter((e) => e.hp > 0);
  const avgEnemyAgi =
    alive.length > 0
      ? alive.reduce((acc, e) => acc + getEffectiveAgility(e), 0) / alive.length
      : 10;
  const pAgi = getEffectiveAgility(player);
  const ratio = pAgi / Math.max(1, avgEnemyAgi);
  const chance = Math.max(0.45, Math.min(0.92, 0.55 + (ratio - 1) * 0.25));
  const chancePct = Math.round(chance * 100);
  const escaped = Math.random() < chance;
  return {
    escaped,
    chancePct,
    log: escaped
      ? `${player.name} threw a smoke bomb and escaped! (${chancePct}%)`
      : `Escape failed (${chancePct}% chance)! Enemies block your retreat!`,
  };
}
