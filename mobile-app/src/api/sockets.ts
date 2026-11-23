import { io, type Socket } from 'socket.io-client';
import { normalizeBaseUrl } from '../config/env';

/**
 * Resolves a Socket.IO endpoint by replacing 'localhost' or '127.0.0.1'
 * with the actual hostname/IP from the active API serverUrl (e.g. 192.168.101.170).
 */
export function resolveSocketUrl(
  serverUrl: string,
  configuredSocketUrl: string | null | undefined,
  defaultPort: number,
  namespacePath = ''
): string {
  try {
    const apiOrigin = new URL(normalizeBaseUrl(serverUrl));
    if (configuredSocketUrl) {
      const parsed = new URL(configuredSocketUrl);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        parsed.hostname = apiOrigin.hostname;
      }
      return parsed.toString().replace(/\/+$/, '');
    }
    return `${apiOrigin.protocol}//${apiOrigin.hostname}:${defaultPort}${namespacePath}`;
  } catch {
    return `http://192.168.101.170:${defaultPort}${namespacePath}`;
  }
}

export function createGlobalChatSocket(serverUrl: string, configuredUrl?: string | null): Socket {
  const base = resolveSocketUrl(serverUrl, configuredUrl, 3002, '');
  const nspUrl = base.endsWith('/global-chat') ? base : `${base}/global-chat`;
  return io(nspUrl, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
  });
}

export function createPvpSocket(serverUrl: string, configuredUrl?: string | null): Socket {
  const base = resolveSocketUrl(serverUrl, configuredUrl, 3000, '/pvp');
  const nspUrl = base.endsWith('/pvp') ? base : `${base}/pvp`;
  return io(nspUrl, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
  });
}

let pvpSocketInstance: Socket | null = null;
let pvpSocketKey = '';

export function getPvpSocket(serverUrl: string, configuredUrl?: string | null): Socket {
  const key = `${serverUrl}_${configuredUrl ?? ''}`;
  if (!pvpSocketInstance || pvpSocketKey !== key || pvpSocketInstance.disconnected) {
    if (pvpSocketInstance) {
      pvpSocketInstance.disconnect();
    }
    pvpSocketInstance = createPvpSocket(serverUrl, configuredUrl);
    pvpSocketKey = key;
  }
  return pvpSocketInstance;
}

export function closePvpSocket(): void {
  if (pvpSocketInstance) {
    pvpSocketInstance.disconnect();
    pvpSocketInstance = null;
    pvpSocketKey = '';
  }
}
