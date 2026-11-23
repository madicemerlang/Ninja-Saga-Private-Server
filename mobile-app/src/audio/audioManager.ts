import { buildAudioUrl } from '../config/env';

// Type definition for safe duck-typed player
interface AudioPlayerLike {
  playing: boolean;
  loop: boolean;
  volume: number;
  play: () => void;
  pause: () => void;
  replace: (source: { uri: string }) => void;
  seekTo: (seconds: number) => Promise<void> | void;
}

interface ExpoAudioModule {
  createAudioPlayer: (source?: { uri: string } | null, options?: Record<string, unknown>) => AudioPlayerLike;
  setAudioModeAsync?: (mode: Record<string, unknown>) => Promise<void>;
}

let ExpoAudio: ExpoAudioModule | null = null;
try {
  // Dynamically resolve expo-audio so module evaluation never throws in Expo Go or web
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ExpoAudio = require('expo-audio') as ExpoAudioModule;
} catch {
  // Native audio module not available in this client environment; fallback silently
  ExpoAudio = null;
}

let bgmPlayer: AudioPlayerLike | null = null;
let currentBgmUrl: string | null = null;
let clickPlayer: AudioPlayerLike | null = null;

/**
 * Plays background music in a loop.
 * If native audio is not supported in the active environment (e.g. Expo Go without audio),
 * it fails gracefully without crashing the app.
 */
export async function playBgm(url: string, volume = 0.5): Promise<void> {
  if (!url || !ExpoAudio) return;
  if (url === currentBgmUrl && bgmPlayer?.playing) return;

  try {
    if (bgmPlayer) {
      bgmPlayer.pause();
      bgmPlayer.replace({ uri: url });
    } else {
      bgmPlayer = ExpoAudio.createAudioPlayer({ uri: url });
    }
    currentBgmUrl = url;
    bgmPlayer.loop = true;
    bgmPlayer.volume = volume;
    bgmPlayer.play();
  } catch (err) {
    console.warn('[AudioManager] Failed to play BGM:', err);
    currentBgmUrl = null;
  }
}

/**
 * Stops any currently playing BGM.
 */
export async function stopBgm(): Promise<void> {
  try {
    if (bgmPlayer) {
      bgmPlayer.pause();
    }
  } catch (err) {
    console.warn('[AudioManager] Failed to stop BGM:', err);
  } finally {
    currentBgmUrl = null;
  }
}

/**
 * Plays the UI button click sound effect.
 */
export async function playClickSfx(baseUrl: string, volume = 0.6): Promise<void> {
  if (!baseUrl || !ExpoAudio) return;
  const url = buildAudioUrl(baseUrl, 'click.mp3');

  try {
    if (!clickPlayer) {
      clickPlayer = ExpoAudio.createAudioPlayer({ uri: url });
      clickPlayer.loop = false;
    } else {
      clickPlayer.seekTo(0);
    }
    clickPlayer.volume = volume;
    clickPlayer.play();
  } catch (err) {
    console.warn('[AudioManager] Failed to play click SFX:', err);
  }
}
