export const DEFAULT_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://192.168.101.170:8080';

// Self-hosted Ruffle WASM on Docker Nginx (no CDN dependency!)
export const DEFAULT_RUFFLE_SCRIPT_URL =
  process.env.EXPO_PUBLIC_RUFFLE_URL ??
  `${DEFAULT_API_BASE_URL}/ruffle/ruffle.js`;

export const SWF_CACHE_BUSTER = 'v55';

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
  equipTag = '',
  previewOverrides?: {
    weapon?: string;
    clothing?: string;
    back?: string;
    hair?: string;
    hairColor?: string;
    bg?: string;
    portrait?: boolean;
  }
): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const qs = new URLSearchParams({ anim, cb: SWF_CACHE_BUSTER });
  if (equipTag) qs.set('v', equipTag);
  if (previewOverrides?.weapon) qs.set('weapon', previewOverrides.weapon);
  if (previewOverrides?.clothing) qs.set('clothing', previewOverrides.clothing);
  if (previewOverrides?.back) qs.set('back', previewOverrides.back);
  if (previewOverrides?.hair) qs.set('hair', previewOverrides.hair);
  if (previewOverrides?.hairColor) qs.set('hair_color', previewOverrides.hairColor);
  if (previewOverrides?.bg) qs.set('bg', previewOverrides.bg);
  if (previewOverrides?.portrait) qs.set('portrait', '1');
  return `${cleanBase}/api/v1/assets/player/${charId}.swf?${qs.toString()}`;
}

export function buildPlayerPreviewSwfUrl(
  baseUrl: string,
  gender: 0 | 1,
  hairNum: number,
  hairColor = '0|0'
): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const qs = new URLSearchParams({
    gender: String(gender),
    hair_num: String(hairNum),
    hair_color: hairColor,
    cb: SWF_CACHE_BUSTER,
  });
  return `${cleanBase}/api/v1/assets/player-preview.swf?${qs.toString()}`;
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

export function buildSkillIconsSwfUrl(baseUrl: string, skillsCsv: string): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const qs = new URLSearchParams({ skills: skillsCsv, cb: SWF_CACHE_BUSTER });
  return `${cleanBase}/api/v1/assets/skill-icons.swf?${qs.toString()}`;
}

export function buildIconSheetSwfUrl(
  baseUrl: string,
  category: 'skills' | 'items' | 'materials' | 'consumables' | 'pets',
  idsCsv: string
): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const qs = new URLSearchParams({ ids: idsCsv, cb: SWF_CACHE_BUSTER });
  return `${cleanBase}/api/v1/assets/icon-sheet/${category}.swf?${qs.toString()}`;
}

export function buildBattleSwfUrl(
  baseUrl: string,
  charId: number,
  enemyId: string,
  skillsCsv: string,
  equipTag = '',
  bg = '',
  alliesCsv = ''
): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const cleanEnemy = enemyId.replace(/\.swf$/i, '');
  const qs = new URLSearchParams({ skills: skillsCsv, cb: SWF_CACHE_BUSTER });
  if (equipTag) qs.set('v', equipTag);
  if (bg) qs.set('bg', bg.replace(/\.swf$/i, ''));
  if (alliesCsv) qs.set('allies', alliesCsv);
  return `${cleanBase}/api/v1/assets/battle/${charId}/${encodeURIComponent(cleanEnemy)}.swf?${qs.toString()}`;
}
