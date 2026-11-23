import React, { useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileApiClient } from '../api/client';
import { buildSwfAssetUrl } from '../config/env';
import {
  RuffleStageView,
  type RuffleStageHandle,
  type StageEvent,
} from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

const CATEGORIES = [
  'enemy',
  'skills',
  'items',
  'pets',
  'npcs',
  'consumables',
  'essentials',
  'materials',
  'mission',
  'swfpanels',
] as const;

export function StagePocScreen() {
  const stageRef = useRef<RuffleStageHandle>(null);

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const setServerUrl = useAuthStore((s) => s.setServerUrl);
  const username = useAuthStore((s) => s.username);
  const characters = useAuthStore((s) => s.characters);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);
  const setLoginSession = useAuthStore((s) => s.setLoginSession);

  const [urlInput, setUrlInput] = useState(serverUrl);
  const [loginUser, setLoginUser] = useState('admin');
  const [loginPass, setLoginPass] = useState('admin');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('enemy');
  const [swfFiles, setSwfFiles] = useState<string[]>([]);
  const [activeSwf, setActiveSwf] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [heapMB, setHeapMB] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>(['Stage PoC initialized (Landscape)']);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const appendLog = (line: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...prev].slice(0, 25));
  };

  const handleStageEvent = (ev: StageEvent) => {
    if (ev.type === 'MEMORY_REPORT') {
      setHeapMB(ev.wasmHeapMB);
      appendLog(`WASM Heap: ${ev.wasmHeapMB} MB (${ev.memoryCount} mem)`);
      return;
    }
    if (ev.type === 'HOLD_STATE') {
      setHeld(ev.held);
    }
    appendLog(`${ev.type}: ${JSON.stringify(ev)}`);
  };

  const handleApplyServerAndCheck = async () => {
    setServerUrl(urlInput);
    api.setBaseUrl(urlInput);
    try {
      const h = await api.health();
      appendLog(`Health OK: swf_assets_ready=${h.swf_assets_ready}`);
      await loadCategoryFiles(category, urlInput);
    } catch (err) {
      appendLog(`Health Error: ${String(err)}`);
    }
  };

  const handleLogin = async () => {
    api.setBaseUrl(urlInput);
    setServerUrl(urlInput);
    try {
      const res = await api.login(loginUser, loginPass);
      setLoginSession(res);
      appendLog(`Login OK: uid=${res.uid}, chars=${res.characters?.account_data?.length ?? 0}`);
    } catch (err) {
      appendLog(`Login Error: ${String(err)}`);
    }
  };

  const loadCategoryFiles = async (
    cat: (typeof CATEGORIES)[number],
    overrideUrl?: string
  ) => {
    setCategory(cat);
    if (overrideUrl) api.setBaseUrl(overrideUrl);
    try {
      const res = await api.listSwfAssets(cat, '', 150);
      setSwfFiles(res.files);
      appendLog(`Loaded ${res.count} SWF files from '${cat}'`);
    } catch (err) {
      appendLog(`List SWF Error (${cat}): ${String(err)}`);
    }
  };

  const handlePlaySwf = (file: string) => {
    setActiveSwf(`${category}/${file}`);
    const swfUrl = buildSwfAssetUrl(api.getBaseUrl(), category, file);
    stageRef.current?.loadSwf(swfUrl);
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Left Column: Landscape Ruffle Stage */}
      <View style={styles.stagePane}>
        <View style={styles.stageHeader}>
          <View style={styles.row}>
            <Pressable
              style={styles.btn}
              onPress={() => navigate(profile ? 'hub' : 'login')}
            >
              <Text style={styles.btnText}>← Back</Text>
            </Pressable>
            <Text style={styles.title}>Ruffle SWF Lab (Landscape)</Text>
          </View>
          <Text style={styles.meta}>
            {activeSwf ? `SWF: ${activeSwf}` : 'Pilih SWF di panel kanan'}
            {heapMB !== null ? `  |  WASM: ${heapMB} MB` : ''}
          </Text>
        </View>

        <View style={styles.stageCanvas}>
          <RuffleStageView
            ref={stageRef}
            baseUrl={serverUrl}
            onEvent={handleStageEvent}
          />
        </View>

        <View style={styles.stageControls}>
          <Pressable
            style={[styles.btn, held && styles.btnActive]}
            onPress={() => stageRef.current?.setHoldFrames(!held)}
          >
            <Text style={styles.btnText}>{held ? 'Resume Frames' : 'Hold Frames'}</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => stageRef.current?.pumpFrame()}>
            <Text style={styles.btnText}>Pump +1 Frame</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => stageRef.current?.requestMemoryReport()}>
            <Text style={styles.btnText}>Heap Probe</Text>
          </Pressable>
          <Pressable style={styles.btnDanger} onPress={() => stageRef.current?.clearStage()}>
            <Text style={styles.btnText}>Clear</Text>
          </Pressable>
        </View>
      </View>

      {/* Right Column: Server, Auth, SWF Browser & Bridge Logs */}
      <View style={styles.controlPane}>
        <Text style={styles.sectionTitle}>1. Docker Server (LAN IP / VPS)</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="http://192.168.1.10:8080"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
          />
          <Pressable style={styles.btnPrimary} onPress={handleApplyServerAndCheck}>
            <Text style={styles.btnText}>Connect</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>
          2. Auth {username ? `(Logged in: ${username}, ${characters.length} chars)` : ''}
        </Text>
        <View style={styles.row}>
          <TextInput
            style={styles.inputSmall}
            value={loginUser}
            onChangeText={setLoginUser}
            placeholder="Username"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.inputSmall}
            value={loginPass}
            onChangeText={setLoginPass}
            placeholder="Password"
            placeholderTextColor="#64748B"
            secureTextEntry
          />
          <Pressable style={styles.btnPrimary} onPress={handleLogin}>
            <Text style={styles.btnText}>Login</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>3. SWF Asset Picker</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              style={[styles.chip, category === cat && styles.chipActive]}
              onPress={() => loadCategoryFiles(cat)}
            >
              <Text style={styles.chipText}>{cat}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.fileList} contentContainerStyle={styles.fileListContent}>
          {swfFiles.map((file) => (
            <Pressable
              key={file}
              style={[styles.fileItem, activeSwf === `${category}/${file}` && styles.fileItemActive]}
              onPress={() => handlePlaySwf(file)}
            >
              <Text style={styles.fileText}>{file}</Text>
            </Pressable>
          ))}
          {swfFiles.length === 0 && (
            <Text style={styles.emptyText}>Tekan Connect atau pilih kategori untuk memuat daftar SWF.</Text>
          )}
        </ScrollView>

        <Text style={styles.sectionTitle}>4. Bridge Logs</Text>
        <ScrollView style={styles.logBox}>
          {logs.map((l, idx) => (
            <Text key={idx} style={styles.logLine}>
              {l}
            </Text>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#0B1220',
  },
  stagePane: {
    flex: 1.45,
    padding: 10,
    borderRightWidth: 1,
    borderRightColor: '#1E293B',
  },
  stageHeader: {
    marginBottom: 6,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  meta: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  stageCanvas: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  stageControls: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  controlPane: {
    flex: 1,
    padding: 10,
  },
  sectionTitle: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    fontSize: 12,
  },
  inputSmall: {
    flex: 1,
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    fontSize: 12,
  },
  btn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnActive: {
    backgroundColor: '#B45309',
  },
  btnPrimary: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnDanger: {
    backgroundColor: '#991B1B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 6,
  },
  chip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  chipActive: {
    backgroundColor: '#0EA5E9',
  },
  chipText: {
    color: '#F8FAFC',
    fontSize: 11,
  },
  fileList: {
    maxHeight: 95,
    backgroundColor: '#0F172A',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  fileListContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 4,
    gap: 4,
  },
  fileItem: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 4,
  },
  fileItemActive: {
    backgroundColor: '#059669',
  },
  fileText: {
    color: '#E2E8F0',
    fontSize: 10,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 11,
    padding: 6,
  },
  logBox: {
    flex: 1,
    backgroundColor: '#020617',
    borderRadius: 6,
    padding: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  logLine: {
    color: '#86EFAC',
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
});
