import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { DEFAULT_RUFFLE_SCRIPT_URL } from '../config/env';
import { useAuthStore } from '../store/useAuthStore';
import { buildRuffleStageHtml } from './stageHtml';

const TypedWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<WebView> }
>;

export type StageEvent =
  | { type: 'BRIDGE_READY'; hasRuffle: boolean }
  | { type: 'PRELOAD_DONE'; count: number }
  | { type: 'STAGE_LOADING'; url: string }
  | { type: 'STAGE_FETCHED'; url: string; bytes: number }
  | { type: 'STAGE_READY'; url: string }
  | { type: 'STAGE_CLEARED' }
  | { type: 'ANIM_HIT' }
  | { type: 'ANIM_DONE' }
  | { type: 'SKILL_ICONS'; icons: Record<string, string> }
  | { type: 'HOLD_STATE'; held: boolean }
  | { type: 'MEMORY_REPORT'; wasmHeapMB: number; memoryCount: number }
  | { type: 'STAGE_ERROR'; message: string };

export interface RuffleStageHandle {
  loadSwf: (url: string) => void;
  playSequence: (seq: string) => void;
  preloadSwfs: (urls: string[]) => void;
  captureSkillIcons: (url: string, skillIds: string[]) => void;
  setSpeed: (speed: 1 | 1.5) => void;
  setHoldFrames: (held: boolean) => void;
  pumpFrame: () => void;
  requestMemoryReport: () => void;
  clearStage: () => void;
}

interface RuffleStageViewProps {
  baseUrl?: string;
  ruffleScriptUrl?: string;
  onEvent?: (event: StageEvent) => void;
}

export const RuffleStageView = forwardRef<RuffleStageHandle, RuffleStageViewProps>(
  function RuffleStageView(
    {
      baseUrl = 'http://192.168.101.170:8080/',
      ruffleScriptUrl = DEFAULT_RUFFLE_SCRIPT_URL,
      onEvent,
    },
    ref
  ) {
    const webViewRef = useRef<WebView>(null);
    const bridgeReadyRef = useRef(false);
    const pendingSwfUrlRef = useRef<string | null>(null);
    const graphicsQuality = useAuthStore((s) => s.graphicsQuality);

    const html = useMemo(
      () => buildRuffleStageHtml(ruffleScriptUrl, graphicsQuality),
      [ruffleScriptUrl, graphicsQuality]
    );

    const sendCommand = (cmd: Record<string, unknown>) => {
      const serialized = JSON.stringify(cmd);
      webViewRef.current?.injectJavaScript(
        `window.__stageCommand && window.__stageCommand(${serialized}); true;`
      );
    };

    useImperativeHandle(ref, () => ({
      loadSwf: (url: string) => {
        if (!bridgeReadyRef.current) {
          pendingSwfUrlRef.current = url;
          return;
        }
        sendCommand({ type: 'LOAD_SWF', url });
      },
      playSequence: (seq: string) => sendCommand({ type: 'PLAY_SEQ', seq }),
      preloadSwfs: (urls: string[]) => sendCommand({ type: 'PRELOAD_SWFS', urls }),
      captureSkillIcons: (url: string, skillIds: string[]) =>
        sendCommand({ type: 'CAPTURE_SKILL_ICONS', url, skillIds }),
      setSpeed: (speed: 1 | 1.5) => sendCommand({ type: 'SET_SPEED', speed }),
      setHoldFrames: (held: boolean) => sendCommand({ type: 'HOLD_FRAMES', held }),
      pumpFrame: () => sendCommand({ type: 'PUMP_FRAME' }),
      requestMemoryReport: () => sendCommand({ type: 'GET_MEMORY' }),
      clearStage: () => {
        pendingSwfUrlRef.current = null;
        sendCommand({ type: 'CLEAR_STAGE' });
      },
    }));

    const handleMessage = (e: WebViewMessageEvent) => {
      try {
        const parsed = JSON.parse(e.nativeEvent.data) as StageEvent;
        if (parsed.type === 'BRIDGE_READY') {
          bridgeReadyRef.current = true;
          if (pendingSwfUrlRef.current) {
            const queued = pendingSwfUrlRef.current;
            pendingSwfUrlRef.current = null;
            sendCommand({ type: 'LOAD_SWF', url: queued });
          }
        }
        onEvent?.(parsed);
      } catch {
        onEvent?.({ type: 'STAGE_ERROR', message: `Malformed bridge payload: ${e.nativeEvent.data}` });
      }
    };

    return (
      <View style={styles.container} renderToHardwareTextureAndroid shouldRasterizeIOS>
        <TypedWebView
          ref={webViewRef}
          source={{
            html,
            baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
          }}
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          androidLayerType="hardware"
          scrollEnabled={false}
          bounces={false}
          onMessage={handleMessage}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
