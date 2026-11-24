import { Image } from 'react-native';
import { loadGameData, loadLibraryData, loadPetsJson } from '../api/gameData';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import {
  buildAudioUrl,
  buildPlayerPreviewSwfUrl,
  normalizeBaseUrl,
} from '../config/env';

export interface PreloadProgress {
  progress: number; // 0 to 1
  label: string;
}

const LOCAL_SCENE_IMAGES = [
  require('../../assets/login_bg.jpg'),
  require('../../assets/select_char_bg.jpg'),
  require('../../assets/village_hub_bg.jpg'),
  BUILDING_BGS.missionRoom,
  BUILDING_BGS.academy,
  BUILDING_BGS.pvpArena,
  BUILDING_BGS.talentHall,
  BUILDING_BGS.blacksmith,
  BUILDING_BGS.ninjaShop,
  BUILDING_BGS.petShop,
  BUILDING_BGS.huntingHouse,
];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);
    promise
      .then((val) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      });
  });
}

async function warmFetch(url: string, timeoutMs = 4500): Promise<void> {
  await withTimeout(
    fetch(url, { cache: 'force-cache' }).then((r) => (r.ok ? r.arrayBuffer() : null)),
    timeoutMs
  );
}

/**
 * Preloads all core game resources at app startup so Village Map, Character Select,
 * Academy, Shop, Blacksmith, Encyclopedia, Recruit, and Battle open smoothly with minimal delay.
 */
export async function preloadInitialResources(
  serverUrl: string,
  onProgress: (state: PreloadProgress) => void
): Promise<void> {
  const cleanBase = normalizeBaseUrl(serverUrl);

  // 1) Local Village Map, Login, Character Select & 8 Building Interior Scenes (0% -> 28%)
  onProgress({ progress: 0.08, label: 'Loading Village Map & Scenes' });
  await Promise.all(
    LOCAL_SCENE_IMAGES.map((asset) => {
      try {
        const resolved = Image.resolveAssetSource(asset);
        if (resolved?.uri) {
          return withTimeout(Image.prefetch(resolved.uri), 2500);
        }
      } catch {
        // Ignore on platforms where local assets are already in bundle memory
      }
      return Promise.resolve(null);
    })
  );
  onProgress({ progress: 0.28, label: 'Loading Jutsu, Missions & Enemies' });

  // 2) Core Game Data JSON (skills, missions, enemies, skill effects) (28% -> 52%)
  await withTimeout(loadGameData(cleanBase), 5000);
  onProgress({ progress: 0.52, label: 'Loading Character Gear, Pets & NPCs' });

  // 3) Library Gear, Pets, NPCs & Senjutsu JSON bundles (52% -> 76%)
  await Promise.all([
    withTimeout(loadLibraryData(cleanBase), 5000),
    withTimeout(loadPetsJson(cleanBase), 4500),
    warmFetch(`${cleanBase}/game_data/npc.json`, 4000),
    warmFetch(`${cleanBase}/game_data/senjutsu.json`, 4000),
  ]);
  onProgress({ progress: 0.76, label: 'Loading Character & Battle Engine' });

  // 4) Warm Ruffle WASM Runtime, Create-Character Preview SWFs (Male/Female + starter hairs & colors) & Core Audio (76% -> 100%)
  const previewSwfUrls: string[] = [
    buildPlayerPreviewSwfUrl(cleanBase, 0, 1, '0|0'),
    buildPlayerPreviewSwfUrl(cleanBase, 1, 1, '0|0'),
    buildPlayerPreviewSwfUrl(cleanBase, 0, 2, '0|0'),
    buildPlayerPreviewSwfUrl(cleanBase, 1, 2, '0|0'),
    buildPlayerPreviewSwfUrl(cleanBase, 0, 3, '0|0'),
    buildPlayerPreviewSwfUrl(cleanBase, 1, 3, '0|0'),
    buildPlayerPreviewSwfUrl(cleanBase, 0, 1, '14423100|0'),
    buildPlayerPreviewSwfUrl(cleanBase, 0, 1, '16435989|0'),
  ];
  await Promise.all([
    warmFetch(`${cleanBase}/ruffle/ruffle.js`, 4500),
    warmFetch(buildAudioUrl(cleanBase, 'bgm.mp3'), 3500),
    warmFetch(buildAudioUrl(cleanBase, 'click.mp3'), 2500),
    ...previewSwfUrls.map((u) => warmFetch(u, 4500)),
  ]);
  onProgress({ progress: 1.0, label: 'Entering Ninja Village' });
}
