import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { DEFAULT_API_BASE_URL, normalizeBaseUrl } from '../config/env';
import type { BattleStartResponse, CharacterSummary, LoginResponse } from '../api/client';

export const SAVED_CREDS_STORAGE_KEY = '@ninjasage_saved_creds_v1';

export type ScreenName =
  | 'login'
  | 'charSelect'
  | 'hub'
  | 'missions'
  | 'battle'
  | 'inventory'
  | 'bag'
  | 'myJutsu'
  | 'stats'
  | 'pet'
  | 'petShop'
  | 'petVilla'
  | 'academy'
  | 'hunting'
  | 'forge'
  | 'talent'
  | 'headquarter'
  | 'senjutsu'
  | 'daily'
  | 'social'
  | 'recruit'
  | 'encyclopedia'
  | 'chat'
  | 'pvp'
  | 'pvpBattle'
  | 'poc';

export interface RecruitedMember {
  id: string;
  name: string;
  level: number;
  hp: number;
  cp: number;
  agility: number;
  kind: 'npc' | 'friend';
  equippedSkills?: string[];
}

export interface PvpBattleSession {
  battleId: string;
  isHost: boolean;
  myCharId: number;
  opponentCharId: number;
  opponentName?: string;
  opponentLevel?: number;
  stage?: string;
}

export interface CharacterPoints {
  wind: number;
  fire: number;
  lightning: number;
  water: number;
  earth: number;
  free: number;
}

export interface ActiveCharacterProfile {
  charId: number;
  name: string;
  gender: number;
  level: number;
  xp: number;
  prevLevelXp: number;
  nextLevelXp: number;
  gold: number;
  tp: number;
  tokens: number;
  rank: number;
  element1: number;
  element2: number;
  element3: number;
  talent1: string;
  talent2: string;
  talent3: string;
  senjutsuType: string | null;
  ss: number;
  senjutsuSkills: string;
  equippedPet: number | null;
  weapon: string;
  clothing: string;
  back: string;
  accessory: string;
  hairStyle: string;
  hairColor: string;
  skinColor: string;
  equippedSkills: string[];
  ownedSkills: string[];
  ownedWeapons: string[];
  ownedClothing: string[];
  ownedBackItems: string[];
  ownedAccessories: string[];
  ownedHairs: string[];
  ownedMaterials: Record<string, number>;
  ownedItems: Record<string, number>;
  points: CharacterPoints;
  raw: Record<string, unknown>;
}

interface AuthState {
  screen: ScreenName;
  serverUrl: string;
  uid: number | null;
  username: string | null;
  accountType: number;
  sessionKey: string | null;
  characters: CharacterSummary[];
  activeCharacterId: number | null;
  profile: ActiveCharacterProfile | null;
  activeBattle: BattleStartResponse | null;
  activePvpBattle: PvpBattleSession | null;
  pvpSocketUrl: string | null;
  chatSocketUrl: string | null;
  graphicsQuality: 'low' | 'medium' | 'high';
  battleSpeed: 1 | 1.5;
  recruitedTeam: RecruitedMember[];
  rememberCredentials: boolean;
  savedUsername: string;
  savedPassword: string;

  navigate: (screen: ScreenName) => void;
  setServerUrl: (url: string) => void;
  setGraphicsQuality: (quality: 'low' | 'medium' | 'high') => void;
  setBattleSpeed: (speed: 1 | 1.5) => void;
  setSavedCredentials: (remember: boolean, username: string, password: string) => void;
  recruitMember: (member: RecruitedMember) => boolean;
  dismissMember: (id: string) => void;
  clearTeam: () => void;
  setLoginSession: (res: LoginResponse) => void;
  setCharacters: (list: CharacterSummary[]) => void;
  setActiveCharacterId: (id: number) => void;
  setProfileFromRaw: (charId: number, raw: Record<string, unknown>) => void;
  patchProfileStats: (patch: { level?: number; xp?: number; gold?: number }) => void;
  setActiveBattle: (battle: BattleStartResponse | null) => void;
  setActivePvpBattle: (session: PvpBattleSession | null) => void;
  logout: () => void;
}

function parseInvIds(rawVal: unknown, fallbackId?: string): string[] {
  const list = String(rawVal ?? '')
    .split(',')
    .map((entry) => entry.split(':')[0].trim())
    .filter(Boolean);
  if (fallbackId && !list.includes(fallbackId)) {
    list.unshift(fallbackId);
  }
  return Array.from(new Set(list));
}

function parseMaterialCounts(rawVal: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  const str = String(rawVal ?? '');
  if (!str) return counts;
  for (const entry of str.split(',')) {
    const [id, qtyStr] = entry.split(':');
    const cleanId = (id ?? '').trim();
    if (!cleanId) continue;
    const qty = Number(qtyStr ?? 1);
    counts[cleanId] = (counts[cleanId] ?? 0) + (Number.isFinite(qty) && qty > 0 ? qty : 1);
  }
  return counts;
}

function parseProfile(charId: number, raw: Record<string, unknown>): ActiveCharacterProfile {
  const cd = (raw.character_data ?? raw) as Record<string, unknown>;
  const acc = (raw.account_data ?? {}) as Record<string, unknown>;
  const sets = (raw.character_sets ?? {}) as Record<string, unknown>;
  const pts = (raw.character_points ?? {}) as Record<string, unknown>;
  const rawSkills = String(sets.skills ?? cd.equipment_skills ?? 'skill_01');
  const equippedSkills = rawSkills
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const inv = (raw.character_inventory ?? {}) as Record<string, unknown>;
  const rawOwnedSkills = String(inv.char_skills ?? raw.character_skills ?? rawSkills);
  const ownedSkills = Array.from(
    new Set(
      rawOwnedSkills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .concat(equippedSkills)
    )
  );

  const weapon = String(sets.weapon ?? cd.equipment_weapon ?? 'wpn_01');
  const clothing = String(sets.clothing ?? cd.equipment_clothing ?? 'set_01_0');
  const back = String(sets.back_item ?? cd.equipment_back ?? 'back_01');
  const accessory = String(sets.accessory ?? cd.equipment_accessory ?? 'accessory_01');
  const hairStyle = String(sets.hairstyle ?? cd.hair_style ?? 'hair_01_0');

  return {
    charId,
    name: String(cd.character_name ?? cd.name ?? `Ninja #${charId}`),
    gender: Number(cd.character_gender ?? cd.gender ?? 0),
    level: Number(cd.character_level ?? cd.level ?? 1),
    xp: Number(cd.character_xp ?? cd.xp ?? 0),
    prevLevelXp: Number(raw.prev_level_xp ?? 0),
    nextLevelXp: Number(raw.next_level_xp ?? Math.max(100, Number(cd.character_level ?? cd.level ?? 1) * 150)),
    gold: Number(cd.character_gold ?? cd.gold ?? 0),
    tp: Number(cd.character_tp ?? cd.tp ?? 0),
    tokens: Number(acc.account_tokens ?? cd.tokens ?? raw.account_tokens ?? 0),
    rank: Number(cd.character_rank ?? cd.rank ?? 1),
    element1: Number(cd.character_element_1 ?? cd.element_1 ?? 0),
    element2: Number(cd.character_element_2 ?? cd.element_2 ?? 0),
    element3: Number(cd.character_element_3 ?? cd.element_3 ?? 0),
    talent1: String(cd.character_talent_1 ?? cd.talent_1 ?? ''),
    talent2: String(cd.character_talent_2 ?? cd.talent_2 ?? ''),
    talent3: String(cd.character_talent_3 ?? cd.talent_3 ?? ''),
    senjutsuType: (raw.senjutsu_type ?? cd.senjutsu_type ?? null) ? String(raw.senjutsu_type ?? cd.senjutsu_type) : null,
    ss: Number(raw.character_ss ?? cd.character_ss ?? cd.ss ?? 0),
    senjutsuSkills: String(raw.senjutsu_skills ?? cd.senjutsu_skills ?? ''),
    equippedPet: (() => {
      const petObj = (raw.pet_data ?? {}) as Record<string, unknown>;
      const val = sets.pet ?? cd.equipment_pet ?? petObj.pet_id ?? petObj.pet ?? null;
      const num = val ? Number(val) : 0;
      return num > 0 ? num : null;
    })(),
    weapon,
    clothing,
    back,
    accessory,
    hairStyle,
    hairColor: String(sets.hair_color ?? cd.hair_color ?? '0|0'),
    skinColor: String(sets.skin_color ?? cd.skin_color ?? 'null|null'),
    equippedSkills,
    ownedSkills: ownedSkills.length > 0 ? ownedSkills : ['skill_01'],
    ownedWeapons: parseInvIds(inv.char_weapons, weapon),
    ownedClothing: parseInvIds(inv.char_sets, clothing),
    ownedBackItems: parseInvIds(inv.char_back_items, back),
    ownedAccessories: parseInvIds(inv.char_accessories, accessory),
    ownedHairs: parseInvIds(inv.char_hairs, hairStyle),
    ownedMaterials: parseMaterialCounts(inv.char_materials),
    ownedItems: parseMaterialCounts(inv.char_items),
    points: {
      wind: Number(pts.atrrib_wind ?? cd.point_wind ?? 0),
      fire: Number(pts.atrrib_fire ?? cd.point_fire ?? 0),
      lightning: Number(pts.atrrib_lightning ?? cd.point_lightning ?? 0),
      water: Number(pts.atrrib_water ?? cd.point_water ?? 0),
      earth: Number(pts.atrrib_earth ?? cd.point_earth ?? 0),
      free: Number(pts.atrrib_free ?? cd.point_free ?? 0),
    },
    raw,
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  screen: 'login',
  serverUrl: DEFAULT_API_BASE_URL,
  uid: null,
  username: null,
  accountType: 0,
  sessionKey: null,
  characters: [],
  activeCharacterId: null,
  profile: null,
  activeBattle: null,
  activePvpBattle: null,
  pvpSocketUrl: null,
  chatSocketUrl: null,
  graphicsQuality: 'high',
  battleSpeed: 1.5,
  recruitedTeam: [],
  rememberCredentials: false,
  savedUsername: '',
  savedPassword: '',

  navigate: (screen) => set({ screen }),

  setServerUrl: (url) => set({ serverUrl: normalizeBaseUrl(url) }),

  setGraphicsQuality: (graphicsQuality) => set({ graphicsQuality }),

  setBattleSpeed: (battleSpeed) => set({ battleSpeed }),

  setSavedCredentials: (remember, username, password) => {
    set({
      rememberCredentials: remember,
      savedUsername: remember ? username : '',
      savedPassword: remember ? password : '',
    });
    if (remember) {
      AsyncStorage.setItem(
        SAVED_CREDS_STORAGE_KEY,
        JSON.stringify({ remember: true, username, password })
      ).catch(() => {});
    } else {
      AsyncStorage.removeItem(SAVED_CREDS_STORAGE_KEY).catch(() => {});
    }
  },

  recruitMember: (member) => {
    let added = false;
    set((state) => {
      if (state.recruitedTeam.some((m) => m.id === member.id)) return state;
      if (state.recruitedTeam.length >= 2) return state;
      added = true;
      return { recruitedTeam: [...state.recruitedTeam, member] };
    });
    return added;
  },

  dismissMember: (id) =>
    set((state) => ({
      recruitedTeam: state.recruitedTeam.filter((m) => m.id !== id),
    })),

  clearTeam: () => set({ recruitedTeam: [] }),

  setLoginSession: (res) => {
    const list = Array.isArray(res.characters?.account_data)
      ? res.characters.account_data
      : [];
    set({
      uid: res.uid,
      username: res.username,
      accountType: Number(res.account_type ?? res.characters?.account_type ?? 0),
      sessionKey: res.sessionkey,
      characters: list,
      activeCharacterId: list[0]?.char_id ?? null,
      pvpSocketUrl: res.sockets?.pvp ?? null,
      chatSocketUrl: res.sockets?.chat ?? null,
      screen: 'charSelect',
    });
  },

  setCharacters: (list) => set({ characters: list }),

  setActiveCharacterId: (id) => set({ activeCharacterId: id }),

  setProfileFromRaw: (charId, raw) =>
    set((state) => ({
      activeCharacterId: charId,
      accountType:
        raw.account_type !== undefined
          ? Number(raw.account_type)
          : state.accountType,
      profile: parseProfile(charId, raw),
    })),

  patchProfileStats: (patch) =>
    set((state) => {
      if (!state.profile) return state;
      return {
        profile: {
          ...state.profile,
          level: patch.level ?? state.profile.level,
          xp: patch.xp ?? state.profile.xp,
          gold: patch.gold ?? state.profile.gold,
        },
      };
    }),

  setActiveBattle: (battle) => set({ activeBattle: battle }),
  setActivePvpBattle: (session) => set({ activePvpBattle: session }),

  logout: () =>
    set({
      screen: 'login',
      uid: null,
      username: null,
      sessionKey: null,
      characters: [],
      activeCharacterId: null,
      profile: null,
      activeBattle: null,
    }),
}));
