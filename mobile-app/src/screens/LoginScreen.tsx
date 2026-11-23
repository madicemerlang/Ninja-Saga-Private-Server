import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileApiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';

export function LoginScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const setServerUrl = useAuthStore((s) => s.setServerUrl);
  const setLoginSession = useAuthStore((s) => s.setLoginSession);
  const navigate = useAuthStore((s) => s.navigate);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [username, setUsername] = useState('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const api = useMemo(() => new MobileApiClient(urlInput), [urlInput]);

  const handleSubmit = async () => {
    setLoading(true);
    setMessage(null);
    setServerUrl(urlInput);
    api.setBaseUrl(urlInput);

    try {
      if (mode === 'register') {
        await api.register(username.trim(), email.trim(), password);
        setMessage('Account created! Logging in...');
      }
      const res = await api.login(username.trim(), password);
      setLoginSession(res);
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Left Hero Panel */}
      <View style={styles.hero}>
        <Text style={styles.brand}>NINJA SAGA</Text>
        <Text style={styles.subtitle}>Mobile Edition • Ruffle WASM + Laravel Docker</Text>
        <Text style={styles.desc}>
          Landscape hybrid client dengan render aset Flash (.swf) langsung dari private server.
        </Text>

        <View style={styles.serverBox}>
          <Text style={styles.label}>Server URL (LAN IP / VPS)</Text>
          <TextInput
            style={styles.input}
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="http://192.168.101.170:8080"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
          />
        </View>

        <Pressable style={styles.pocLink} onPress={() => { setServerUrl(urlInput); navigate('poc'); }}>
          <Text style={styles.pocLinkText}>Open Ruffle SWF PoC Lab →</Text>
        </Pressable>
      </View>

      {/* Right Auth Card */}
      <View style={styles.card}>
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, mode === 'login' && styles.tabActive]}
            onPress={() => { setMode('login'); setMessage(null); }}
          >
            <Text style={styles.tabText}>Login</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, mode === 'register' && styles.tabActive]}
            onPress={() => { setMode('register'); setMessage(null); }}
          >
            <Text style={styles.tabText}>Register</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="admin"
          placeholderTextColor="#64748B"
          autoCapitalize="none"
        />

        {mode === 'register' && (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="ninja@example.com"
              placeholderTextColor="#64748B"
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </>
        )}

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor="#64748B"
          secureTextEntry
        />

        {message && <Text style={styles.errorText}>{message}</Text>}

        <Pressable style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitText}>
              {mode === 'login' ? 'Enter Village' : 'Create Ninja Account'}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#070E1A',
    padding: 18,
    gap: 18,
    alignItems: 'center',
  },
  hero: {
    flex: 1.15,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  brand: {
    color: '#F59E0B',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 2,
  },
  subtitle: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  desc: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 10,
    lineHeight: 18,
  },
  serverBox: {
    marginTop: 18,
  },
  pocLink: {
    marginTop: 14,
    alignSelf: 'flex-start',
  },
  pocLinkText: {
    color: '#94A3B8',
    fontSize: 11,
    textDecorationLine: 'underline',
  },
  card: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 16,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 3,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabActive: {
    backgroundColor: '#2563EB',
  },
  tabText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  label: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 6,
  },
  input: {
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  errorText: {
    color: '#F87171',
    fontSize: 11,
    marginTop: 8,
  },
  submitBtn: {
    marginTop: 14,
    backgroundColor: '#EA580C',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
