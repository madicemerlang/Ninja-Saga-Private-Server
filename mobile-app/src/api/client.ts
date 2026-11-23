import { normalizeBaseUrl } from '../config/env';

export interface CharacterSummary {
  char_id: number;
  character_name: string;
  character_level: number;
  character_rank?: number;
  [key: string]: unknown;
}

export interface LoginResponse {
  status: number;
  uid: number;
  username: string;
  sessionkey: string;
  characters: {
    status?: number;
    account_data?: CharacterSummary[];
    [key: string]: unknown;
  };
  sockets: {
    pvp: string;
    chat: string;
  };
  server_time: number;
  error?: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  timestamp: number;
  swf_assets_ready: boolean;
}

export interface SwfListResponse {
  category: string;
  count: number;
  files: string[];
}

export interface AssetCatalogResponse {
  status: number;
  total_assets: number;
  categories: Record<string, number>;
  audio: string[];
  game_data: string[];
}

export interface BlacksmithRecipeDef {
  req_weapon: string;
  mats: Record<string, number>;
  gold: number;
  tokens: number;
}

export interface TalentCatalogItem {
  talent_id: string;
  name: string;
  description: string;
  price_gold: number;
  price_tokens: number;
  is_emblem: boolean;
  type: string;
}

export interface PetCatalogItem {
  pet_id: string;
  name: string;
  swf: string;
  price_gold: number;
  price_tokens: number;
  premium: boolean;
}

export interface FeatureDataResponse {
  status: number;
  academy_chains: Record<string, Record<string, string[]>>;
  blacksmith_recipes: Record<string, BlacksmithRecipeDef>;
  talent_description: Record<string, { talent_skill_id?: string; [k: string]: unknown }>;
  talent_tp_cost: Record<string, number>;
  talents_catalog: TalentCatalogItem[];
  pets_catalog: PetCatalogItem[];
}

export interface BattleStartResponse {
  status: number;
  token: string;
  mission: {
    id: string;
    name: string;
    bg: string;
    req_lvl: number;
    reward_gold: number;
    reward_xp: number;
  };
  enemies: Array<{
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
  }>;
  error?: string;
}

export interface BattleFinishResponse {
  status: number;
  victory: boolean;
  xp_reward: number;
  gold_reward: number;
  level: number;
  xp: number;
  gold: number;
  level_up: boolean;
  error?: string;
}

export class MobileApiClient {
  constructor(private baseUrl: string) {}

  setBaseUrl(url: string) {
    this.baseUrl = normalizeBaseUrl(url);
  }

  getBaseUrl(): string {
    return normalizeBaseUrl(this.baseUrl);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    headers: Record<string, string> = {}
  ): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers,
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`HTTP ${res.status}: Non-JSON response from ${url}`);
    }

    if (!res.ok) {
      const errMsg =
        typeof json === 'object' && json !== null && 'error' in json
          ? String((json as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new Error(errMsg);
    }

    return json as T;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/api/v1/health');
  }

  login(username: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  register(username: string, email: string, password: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  getCharacters(uid: number, sessionKey: string): Promise<LoginResponse['characters']> {
    return this.request<LoginResponse['characters']>('/api/v1/characters', {}, {
      'X-User-Id': String(uid),
      'X-Session-Key': sessionKey,
    });
  }

  createCharacter(
    uid: number,
    sessionKey: string,
    payload: { name: string; gender: number; element: number; hair_color?: string; hair_num?: number }
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      '/api/v1/characters',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      {
        'X-User-Id': String(uid),
        'X-Session-Key': sessionKey,
      }
    );
  }

  battleStart(charId: number, sessionKey: string, missionId: string): Promise<BattleStartResponse> {
    return this.request<BattleStartResponse>(
      '/api/v1/battle/start',
      {
        method: 'POST',
        body: JSON.stringify({ mission_id: missionId }),
      },
      {
        'X-Character-Id': String(charId),
        'X-Session-Key': sessionKey,
      }
    );
  }

  battleStartHunting(
    charId: number,
    sessionKey: string,
    zoneId: number,
    enemyIds?: string[]
  ): Promise<BattleStartResponse> {
    return this.request<BattleStartResponse>(
      '/api/v1/battle/start',
      {
        method: 'POST',
        body: JSON.stringify({
          mission_id: `hunting_zone_${zoneId}`,
          hunting_zone_id: zoneId,
          enemy_ids: enemyIds,
        }),
      },
      {
        'X-Character-Id': String(charId),
        'X-Session-Key': sessionKey,
      }
    );
  }

  getAssetCatalog(): Promise<AssetCatalogResponse> {
    return this.request<AssetCatalogResponse>('/api/v1/assets/catalog');
  }

  getFeatureData(): Promise<FeatureDataResponse> {
    return this.request<FeatureDataResponse>('/api/v1/feature-data');
  }

  battleFinish(
    charId: number,
    sessionKey: string,
    missionId: string,
    token: string,
    victory: boolean
  ): Promise<BattleFinishResponse> {
    return this.request<BattleFinishResponse>(
      '/api/v1/battle/finish',
      {
        method: 'POST',
        body: JSON.stringify({ mission_id: missionId, token, victory }),
      },
      {
        'X-Character-Id': String(charId),
        'X-Session-Key': sessionKey,
      }
    );
  }

  listSwfAssets(category: string, prefix = '', limit = 30): Promise<SwfListResponse> {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (prefix) qs.set('prefix', prefix);
    return this.request<SwfListResponse>(`/api/v1/assets/swf/${encodeURIComponent(category)}?${qs.toString()}`);
  }

  getCharacter(charId: number, sessionKey: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/v1/characters/${charId}`, {}, {
      'X-Session-Key': sessionKey,
    });
  }

  rpc<T = unknown>(
    service: string,
    method: string,
    args: unknown[],
    auth: { sessionKey: string; charId?: number; uid?: number }
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {
      'X-Session-Key': auth.sessionKey,
    };
    if (auth.charId !== undefined) headers['X-Character-Id'] = String(auth.charId);
    if (auth.uid !== undefined) headers['X-User-Id'] = String(auth.uid);

    return this.request<{ status: number; data: T }>(
      `/api/v1/rpc/${encodeURIComponent(service)}/${encodeURIComponent(method)}`,
      {
        method: 'POST',
        body: JSON.stringify({ args }),
      },
      headers
    );
  }
}
