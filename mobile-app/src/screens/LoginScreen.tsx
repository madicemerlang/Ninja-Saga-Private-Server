import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileApiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';

const LOGIN_BG = require('../../assets/login_bg.jpg');

export function LoginScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const setLoginSession = useAuthStore((s) => s.setLoginSession);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const handleSubmit = async () => {
    setLoading(true);
    setMessage(null);

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
    <View style={styles.root}>
      <Image source={LOGIN_BG} style={styles.bgImg} resizeMode="cover" />
      <View style={styles.scrim} />

      <SafeAreaView style={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.brand}>NINJA SAGA</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, mode === 'login' && styles.tabActive]}
              onPress={() => {
                setMode('login');
                setMessage(null);
              }}
            >
              <Text style={styles.tabText}>Login</Text>
            </Pressable>
            <Pressable
              style={[styles.tab, mode === 'register' && styles.tabActive]}
              onPress={() => {
                setMode('register');
                setMessage(null);
              }}
            >
              <Text style={styles.tabText}>Register</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor="#94A3B8"
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
                placeholderTextColor="#94A3B8"
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
            placeholderTextColor="#94A3B8"
            secureTextEntry
          />

          {message && <Text style={styles.errorText}>{message}</Text>}

          <Pressable style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>
                {mode === 'login' ? 'Login' : 'Register'}
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#070E1A',
    position: 'relative',
  },
  bgImg: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5, 9, 18, 0.22)',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 24,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 18,
  },
  brand: {
    color: '#FDE047',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 3,
    textShadowColor: '#000000',
    textShadowOffset: { width: 2, height: 3 },
    textShadowRadius: 8,
  },
  card: {
    width: 330,
    backgroundColor: 'rgba(10, 15, 28, 0.88)',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#C8A24A',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.75,
    shadowRadius: 12,
    elevation: 10,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderRadius: 8,
    padding: 3,
    marginBottom: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabActive: {
    backgroundColor: '#EA580C',
  },
  tabText: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 12,
  },
  label: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
    marginTop: 6,
  },
  input: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    color: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
  },
  submitBtn: {
    marginTop: 14,
    backgroundColor: '#EA580C',
    borderWidth: 1,
    borderColor: '#FDE047',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 0.6,
  },
});
