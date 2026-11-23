import { normalizeBaseUrl } from '../config/env';

export interface MissionDef {
  id: string;
  name: string;
  grade: string;
  level: number;
  description: string;
  bg: string;
  enemies: string[];
  rewards: {
    xp: number;
    gold: number;
    tp?: number;
    ss?: number;
  };
  visible?: boolean;
}

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  level: number;
  damage: number;
  cp_cost: number;
  cooldown: number;
  price_gold: number;
  price_tokens: number;
  buyable: boolean;
  type: string;
}

export interface RawSkillEffectDef {
  target?: 'self' | 'enemy' | string;
  type?: 'Buff' | 'Debuff' | string;
  effect: string;
  effect_name?: string;
  duration?: number;
  amount_duration?: number;
  calc_type?: 'percent' | 'number' | '' | string;
  amount?: number;
  amount_cp?: number;
  amount_protection?: number;
  reduce_type?: 'MAX' | 'CURRENT' | string;
  chance?: number;
  multi_hit?: boolean;
  passive?: boolean;
  no_disperse?: boolean;
}

export interface SkillEffectEntry {
  skill_id: string;
  skill_effect: RawSkillEffectDef[];
}

export interface EnemyDef {
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
  calculation?: number;
  calculation_agility?: number;
  attacks?: Array<{
    dmg?: number;
    animation?: string;
    cooldown?: number;
    multi_hit?: boolean;
    effects?: RawSkillEffectDef[];
  }>;
}

export interface LibraryItemDef {
  id: string;
  name: string;
  description: string;
  type: 'wpn' | 'set' | 'back' | 'accessory' | 'hair' | 'item' | 'essential' | string;
  level: number;
  damage: number;
  price_gold: number;
  price_tokens: number;
  buyable: boolean;
  premium?: boolean;
}

export interface PetJsonDef {
  id: string;
  name: string;
  level: number;
  dodge: number;
  critical: number;
  agility: number;
  description: string;
  emblem?: boolean;
  attacks?: Array<{
    level: number;
    name: string;
    description: string;
    cooldown: number;
    dmg?: number;
  }>;
}

let cachedPetsUrl: string | null = null;
let cachedPetsById: Record<string, PetJsonDef> | null = null;

export async function loadPetsJson(baseUrl: string): Promise<Record<string, PetJsonDef>> {
  const clean = normalizeBaseUrl(baseUrl);
  if (cachedPetsById && cachedPetsUrl === clean) {
    return cachedPetsById;
  }
  const res = await fetch(`${clean}/game_data/pet.json`);
  if (!res.ok) return {};
  const list = (await res.json()) as PetJsonDef[];
  const byId: Record<string, PetJsonDef> = {};
  if (Array.isArray(list)) {
    for (const p of list) {
      if (p?.id) byId[p.id] = p;
    }
  }
  cachedPetsUrl = clean;
  cachedPetsById = byId;
  return byId;
}

export interface LibraryBundle {
  items: LibraryItemDef[];
  itemsById: Record<string, LibraryItemDef>;
}

let cachedLibraryForBaseUrl: string | null = null;
let cachedLibrary: LibraryBundle | null = null;

export async function loadLibraryData(baseUrl: string): Promise<LibraryBundle> {
  const clean = normalizeBaseUrl(baseUrl);
  if (cachedLibrary && cachedLibraryForBaseUrl === clean) {
    return cachedLibrary;
  }
  const res = await fetch(`${clean}/game_data/library.json`);
  if (!res.ok) {
    throw new Error(`Failed loading library.json (${res.status})`);
  }
  const items = (await res.json()) as LibraryItemDef[];
  const itemsById: Record<string, LibraryItemDef> = {};
  for (const it of items) {
    if (it?.id) itemsById[it.id] = it;
  }
  cachedLibraryForBaseUrl = clean;
  cachedLibrary = { items, itemsById };
  return cachedLibrary;
}

export interface GameDataBundle {
  missions: MissionDef[];
  skills: SkillDef[];
  skillsById: Record<string, SkillDef>;
  skillEffectsById: Record<string, RawSkillEffectDef[]>;
  enemies: EnemyDef[];
  enemiesById: Record<string, EnemyDef>;
}

let cachedForBaseUrl: string | null = null;
let cachedBundle: GameDataBundle | null = null;

export async function loadGameData(baseUrl: string): Promise<GameDataBundle> {
  const clean = normalizeBaseUrl(baseUrl);
  if (cachedBundle && cachedForBaseUrl === clean) {
    return cachedBundle;
  }

  const [mRes, sRes, eRes, seRes] = await Promise.all([
    fetch(`${clean}/game_data/mission.json`),
    fetch(`${clean}/game_data/skills.json`),
    fetch(`${clean}/game_data/enemy.json`),
    fetch(`${clean}/game_data/skill-effect.json`).catch(() => null),
  ]);

  if (!mRes.ok || !sRes.ok || !eRes.ok) {
    throw new Error(`Failed loading game_data JSON (${mRes.status}/${sRes.status}/${eRes.status})`);
  }

  const [missions, skills, enemies] = (await Promise.all([
    mRes.json(),
    sRes.json(),
    eRes.json(),
  ])) as [MissionDef[], SkillDef[], EnemyDef[]];

  const skillEffectsById: Record<string, RawSkillEffectDef[]> = {};
  if (seRes && seRes.ok) {
    try {
      const seList = (await seRes.json()) as SkillEffectEntry[];
      if (Array.isArray(seList)) {
        for (const entry of seList) {
          if (entry?.skill_id && Array.isArray(entry.skill_effect)) {
            skillEffectsById[entry.skill_id] = entry.skill_effect;
          }
        }
      }
    } catch {
      // ignore malformed skill-effect.json
    }
  }

  const skillsById: Record<string, SkillDef> = {};
  for (const s of skills) skillsById[s.id] = s;

  const enemiesById: Record<string, EnemyDef> = {};
  for (const e of enemies) enemiesById[e.id] = e;

  cachedForBaseUrl = clean;
  cachedBundle = {
    missions: missions.filter((m) => m.visible !== false),
    skills,
    skillsById,
    skillEffectsById,
    enemies,
    enemiesById,
  };

  return cachedBundle;
}
