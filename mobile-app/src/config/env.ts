export const DEFAULT_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://192.168.101.170:8080';

// Self-hosted Ruffle WASM on Docker Nginx (no CDN dependency!)
export const DEFAULT_RUFFLE_SCRIPT_URL =
  process.env.EXPO_PUBLIC_RUFFLE_URL ??
  `${DEFAULT_API_BASE_URL}/ruffle/ruffle.js`;

export const SWF_CACHE_BUSTER = 'v10';

export function buildAudioUrl(baseUrl: string, filename: string): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const safeFile = filename.endsWith('.mp3') ? filename : `${filename}.mp3`;
  return `${cleanBase}/audio/${safeFile}`;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function buildSwfAssetUrl(
  baseUrl: string,
  category: string,
  filename: string,
  anim?: string
): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const safeFile = filename.endsWith('.swf') ? filename : `${filename}.swf`;
  const base = `${cleanBase}/api/v1/assets/swf/${encodeURIComponent(category)}/${encodeURIComponent(safeFile)}`;
  const qs = new URLSearchParams({ cb: SWF_CACHE_BUSTER });
  if (anim) qs.set('anim', anim);
  return `${base}?${qs.toString()}`;
}

export function buildPlayerSwfUrl(
  baseUrl: string,
  charId: number,
  anim = 'standby',
  equipTag = ''
): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const qs = new URLSearchParams({ anim, cb: SWF_CACHE_BUSTER });
  if (equipTag) qs.set('v', equipTag);
  return `${cleanBase}/api/v1/assets/player/${charId}.swf?${qs.toString()}`;
}

export function buildPlayerSkillSwfUrl(
  baseUrl: string,
  charId: number,
  skillId: string,
  equipTag = ''
): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const cleanSkill = skillId.replace(/\.swf$/i, '');
  const qs = new URLSearchParams({ cb: SWF_CACHE_BUSTER });
  if (equipTag) qs.set('v', equipTag);
  return `${cleanBase}/api/v1/assets/player/${charId}/skill/${encodeURIComponent(cleanSkill)}.swf?${qs.toString()}`;
}

export function buildBattleSwfUrl(
  baseUrl: string,
  charId: number,
  enemyId: string,
  skillsCsv: string,
  equipTag = ''
): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const cleanEnemy = enemyId.replace(/\.swf$/i, '');
  const qs = new URLSearchParams({ skills: skillsCsv, cb: SWF_CACHE_BUSTER });
  if (equipTag) qs.set('v', equipTag);
  return `${cleanBase}/api/v1/assets/battle/${charId}/${encodeURIComponent(cleanEnemy)}.swf?${qs.toString()}`;
}
