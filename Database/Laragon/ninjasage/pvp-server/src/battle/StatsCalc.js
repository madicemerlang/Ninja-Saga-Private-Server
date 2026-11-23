'use strict';

const SkillData = require('../SkillData');
const ItemData  = require('../ItemData');

/**
 * Server-side stat calculator.
 * Canonical Ninja Saga formulas:
 *
 * • Earth: +30 max HP per point
 * • Water: +30 max CP per point, +1% healing bonus, 0.4% purify chance
 * • Wind:  +0.4% dodge chance and +1 agility per point
 * • Thunder: +0.4% critical chance and +0.8% critical strike damage bonus per point
 * • Fire:  +0.4% extra damage to all damage types per point, 0.4% chance for Combustion (+30% DMG)
 */
function buildStats(char) {
  const lvl        = parseInt(char.level,           10) || 1;
  const earth      = parseInt(char.point_earth,     10) || 0;
  const water      = parseInt(char.point_water,     10) || 0;
  const wind       = parseInt(char.point_wind,      10) || 0;
  const lightning  = parseInt(char.point_lightning, 10) || 0;
  const fire       = parseInt(char.point_fire,      10) || 0;

  const weaponId     = char.equipment_weapon || 'wpn_01';
  const weaponDamage = ItemData.getWeaponDamage(weaponId);

  // Earth: +30 max HP per point
  const maxHp  = 60 + lvl * 40 + earth * 30;

  // Water: +30 max CP per point
  const maxCp  = 60 + lvl * 40 + water * 30;

  // Wind: +1 agility per point, +0.4% dodge chance per point
  const agility  = 9 + lvl + wind * 1;
  const dodgePct = parseFloat(Math.min(60, 5 + wind * 0.4).toFixed(1));   // %

  // Thunder: +0.4% critical chance per point
  const critPct  = parseFloat(Math.min(70, 5 + lightning * 0.4).toFixed(1));   // %

  const baseAtk = weaponDamage > 0 ? weaponDamage : 5;
  const def = Math.floor(lvl * 1.0);

  return {
    maxHp,
    maxCp,
    hp:       maxHp,
    cp:       maxCp,
    agility,
    critPct,
    dodgePct,
    atk:      baseAtk,
    def,
    lvl,
    weaponDamage,
    fire,
    lightning,
    wind,
    earth,
    water,
  };
}

/**
 * Compute effective dodge% for a defender, factoring in active buff/debuff modifiers.
 *   - Dodge-increasing buffs on the defender add to dodge%.
 *   - Dodge-decreasing debuffs on the defender subtract from dodge%.
 *   - Accuracy-decreasing debuffs on the attacker effectively increase dodge%.
 * Capped at [0, 95] so a hit is always possible.
 */
function calcEffectiveDodge(defenderStats, attackerStats) {
  let dodge = defenderStats.dodgePct;

  const DODGE_UP = new Set([
    'reflexes', 'flexible', 'energize', 'pet_energize',
    'evade', 'overwhelm', 'meditation', 'peace', 'invincible',
  ]);
  const DODGE_DOWN = new Set([
    'darkness', 'blind', 'pet_blind', 'slow', 'muddy',
    'embrace', 'dark_curse',
  ]);
  // These debuffs on the attacker reduce accuracy (= defender dodges more)
  const ACCURACY_DOWN = new Set(['darkness', 'blind', 'pet_blind']);

  for (const b of (defenderStats.activeBuffs || [])) {
    if (b.duration <= 0) continue;
    if (b.type === 'Buff'   && DODGE_UP.has(b.effect)   && b.calc_type === 'percent') dodge += b.amount;
    if (b.type === 'Debuff' && DODGE_DOWN.has(b.effect) && b.calc_type === 'percent') dodge -= b.amount;
  }
  for (const b of (attackerStats.activeBuffs || [])) {
    if (b.duration <= 0) continue;
    if (b.type === 'Debuff' && ACCURACY_DOWN.has(b.effect) && b.calc_type === 'percent') dodge += b.amount;
  }

  return Math.max(0, Math.min(95, dodge));
}

/**
 * Calculate weapon-attack damage.
 * Rule: Basic weapon attacks deal the weapon's listed damage with a -20% to +20% damage variance.
 * Fire secondary: +0.4% all damage per point, 0.4% chance for Combustion (+30% DMG)
 * Thunder secondary: +0.8% critical strike damage bonus per point
 * Returns { damage, crit, dodged, combustion }.
 */
function calcWeaponDamage(attackerStats, defenderStats) {
  // Check dodge first (factoring in active buff/debuff modifiers)
  if (Math.random() * 100 < calcEffectiveDodge(defenderStats, attackerStats)) {
    return { damage: 0, crit: false, dodged: true, combustion: false };
  }

  // Listed weapon damage with -20% to +20% variance
  const listedDmg = attackerStats.weaponDamage > 0 ? attackerStats.weaponDamage : 5;
  const variance = 0.80 + Math.random() * 0.40;

  // Fire secondary: +0.4% all damage & 0.4% chance per point for Combustion (+30% all damage for 1 turn)
  const fireAllDmgMult = 1.0 + (attackerStats.fire * 0.004);
  const combustionRoll = Math.random() < (attackerStats.fire * 0.004);
  const combustionMult = combustionRoll ? 1.30 : 1.0;

  // Thunder secondary: +0.8% critical strike damage bonus per point
  const crit = Math.random() * 100 < attackerStats.critPct;
  const critMult = crit ? (1.50 + attackerStats.lightning * 0.008) : 1.0;

  let damage = Math.round(listedDmg * variance * fireAllDmgMult * combustionMult * critMult);

  // Apply active buff/debuff modifiers
  damage = applyDamageModifiers(damage, attackerStats, defenderStats);

  return { damage: Math.max(1, damage), crit, dodged: false, combustion: combustionRoll };
}

/**
 * Calculate skill damage.
 *
 * Rule:
 *   - Each point invested in an element grants +1% extra damage to Ninjutsu of that matching element.
 *   - Fire: +0.4% all damage per point, 0.4% chance per point for Combustion (+30% DMG)
 *   - Thunder: +0.8% critical strike damage bonus per point
 *   - Base damage from skills.bin / skills.json with -20% to +20% variance
 *
 * Returns { damage, crit, dodged, combustion }.
 */
function calcSkillDamage(attackerStats, defenderStats, skillId) {
  const skill     = SkillData.getSkill(skillId);
  const skillType = skill.skill_type;

  // Skills are harder to dodge (50 % of normal dodge chance)
  if (Math.random() * 100 < calcEffectiveDodge(defenderStats, attackerStats) * 0.5) {
    return { damage: 0, crit: false, dodged: true, combustion: false };
  }

  // Ninjutsu Base Damage from skills.bin with -20% to +20% variance
  const skBase   = skill.skill_damage > 0 ? skill.skill_damage : 20;
  const variance = 0.80 + Math.random() * 0.40;

  // Matching elemental bonus: +1% extra damage to Ninjutsu of that matching element
  let matchingElemMult = 1.0;
  switch (skillType) {
    case 1: matchingElemMult += (attackerStats.wind      * 0.01); break;
    case 2: matchingElemMult += (attackerStats.fire      * 0.01); break;
    case 3: matchingElemMult += (attackerStats.lightning * 0.01); break;
    case 4: matchingElemMult += (attackerStats.earth     * 0.01); break;
    case 5: matchingElemMult += (attackerStats.water     * 0.01); break;
  }

  // Fire secondary: +0.4% all damage & 0.4% chance per point for Combustion (+30% DMG)
  const fireAllDmgMult = 1.0 + (attackerStats.fire * 0.004);
  const combustionRoll = Math.random() < (attackerStats.fire * 0.004);
  const combustionMult = combustionRoll ? 1.30 : 1.0;

  // Thunder secondary: +0.8% critical strike damage bonus per point
  const crit = Math.random() * 100 < attackerStats.critPct;
  const critMult = crit ? (1.50 + attackerStats.lightning * 0.008) : 1.0;

  let damage = Math.round(skBase * variance * matchingElemMult * fireAllDmgMult * combustionMult * critMult);

  // Apply active buff/debuff modifiers
  damage = applyDamageModifiers(damage, attackerStats, defenderStats);

  return { damage: Math.max(1, damage), crit, dodged: false, combustion: combustionRoll };
}

/**
 * Apply damage-modifying buffs/debuffs stored in attackerStats.activeBuffs
 * and defenderStats.activeBuffs.
 *
 * Both stats objects carry an optional `activeBuffs` array that Battle.js
 * populates from participant.buffs before passing to the calc functions.
 *
 * Damage-increasing attacker buffs: strengthen, power_up, rage, rampage,
 *   solar_might, invincible, unyielding, sage_mode, stealth, lightning_armor,
 *   domain_expansion
 * Damage-reducing defender buffs: protection, defense_up, turtle
 * Damage-increasing defender debuffs (attackers deal more): weaken
 */
function applyDamageModifiers(damage, attackerStats, defenderStats) {
  const DAMAGE_UP_EFFECTS = new Set([
    'strengthen', 'power_up', 'rage', 'rampage', 'solar_might',
    'invincible', 'unyielding', 'sage_mode', 'stealth',
    'lightning_armor', 'domain_expansion', 'pet_strengthen',
    'taijutsu_strengthen', 'senjutsu_strengthen',
    'concentration',    // skill-damage increase buff (40%)
    'attention',        // accuracy/damage buff (30%)
  ]);
  const DAMAGE_DOWN_EFFECTS = new Set([
    'protection', 'defense_up', 'turtle', 'absorb_damage',
    'plus_protection', 'tolerance',
  ]);
  const WEAKEN_EFFECTS = new Set(['weaken', 'conduction', 'vulnerable', 'infection']);
  // Debuffs applied to the attacker that reduce their outgoing damage
  const ATTACKER_DEBUFF_DOWN = new Set([
    'numb', 'disorient', 'dark_curse', 'embrace', 'holdback', 'ecstasy',
  ]);

  let multiplier = 1.0;

  // Attacker's damage-up buffs and damage-down debuffs
  for (const b of (attackerStats.activeBuffs || [])) {
    if (b.duration > 0 && b.type === 'Buff' && DAMAGE_UP_EFFECTS.has(b.effect)) {
      if (b.calc_type === 'percent') multiplier += b.amount / 100;
    }
    if (b.duration > 0 && b.type === 'Debuff' && ATTACKER_DEBUFF_DOWN.has(b.effect)) {
      if (b.calc_type === 'percent') multiplier -= b.amount / 100;
    }
    // lock: when HP >= 50% acts as a weaken (damage-down debuff on the attacker)
    if (b.duration > 0 && b.effect === 'lock' && b.type === 'Debuff') {
      if (attackerStats.hp >= attackerStats.maxHp * 0.5 && b.calc_type === 'percent') {
        multiplier -= b.amount / 100;
      }
    }
  }

  // Defender's damage-reduction buffs and amplifying debuffs
  for (const b of (defenderStats.activeBuffs || [])) {
    if (b.duration > 0 && b.type === 'Buff' && DAMAGE_DOWN_EFFECTS.has(b.effect)) {
      if (b.calc_type === 'percent') multiplier -= b.amount / 100;
    }
    if (b.duration > 0 && b.type === 'Debuff' && WEAKEN_EFFECTS.has(b.effect)) {
      if (b.calc_type === 'percent') multiplier += b.amount / 100;
    }
  }

  return Math.max(1, Math.floor(damage * Math.max(0, multiplier)));
}

/**
 * Real CP cost for a skill, looked up from skills.bin.
 */
function skillCpCost(skillId) {
  return SkillData.getSkill(skillId).skill_cp_cost;
}

/**
 * Real cooldown (in turns) for a skill, looked up from skills.bin.
 */
function getSkillCooldown(skillId) {
  return SkillData.getSkill(skillId).skill_cooldown;
}

/**
 * CP gained per charge action.
 */
function chargeAmount(attackerStats) {
  return Math.floor(attackerStats.maxCp * 0.2);
}

module.exports = {
  buildStats,
  calcEffectiveDodge,
  calcWeaponDamage,
  calcSkillDamage,
  skillCpCost,
  getSkillCooldown,
  chargeAmount,
  applyDamageModifiers,
};
