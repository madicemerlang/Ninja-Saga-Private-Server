import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileApiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';

const ELEMENTS = [
  { id: 1, name: 'Wind', color: '#10B981' },
  { id: 2, name: 'Fire', color: '#EF4444' },
  { id: 3, name: 'Lightning', color: '#F59E0B' },
  { id: 4, name: 'Earth', color: '#A16207' },
  { id: 5, name: 'Water', color: '#3B82F6' },
];

export function CharSelectScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const uid = useAuthStore((s) => s.uid);
  const username = useAuthStore((s) => s.username);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const characters = useAuthStore((s) => s.characters);
  const setCharacters = useAuthStore((s) => s.setCharacters);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);
  const logout = useAuthStore((s) => s.logout);

  const [charName, setCharName] = useState('');
  const [gender, setGender] = useState<0 | 1>(0);
  const [element, setElement] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const enterWithCharacter = async (charId: number) => {
    if (!sessionKey) return;
    setLoading(true);
    setError(null);
    try {
      const raw = await api.getCharacter(charId, sessionKey);
      setProfileFromRaw(charId, raw);
      navigate('hub');
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!uid || !sessionKey) return;
    if (charName.trim().length < 2) {
      setError('Nama karakter minimal 2 huruf.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.createCharacter(uid, sessionKey, {
        name: charName.trim(),
        gender,
        element,
      });
      if ((res.status as number) !== 1) {
        setError(String(res.error ?? res.result ?? 'Gagal membuat karakter'));
        return;
      }
      const listRes = await api.getCharacters(uid, sessionKey);
      const list = Array.isArray(listRes?.account_data) ? listRes.account_data : [];
      setCharacters(list);
      setCharName('');
      if (list.length > 0) {
        await enterWithCharacter(list[list.length - 1].char_id);
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Left: Existing Characters */}
      <View style={styles.leftPane}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Select Ninja ({username})</Text>
          <Pressable style={styles.logoutBtn} onPress={logout}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {characters.map((c) => (
            <Pressable
              key={c.char_id}
              style={styles.charCard}
              onPress={() => enterWithCharacter(c.char_id)}
              disabled={loading}
            >
              <View>
                <Text style={styles.charName}>{c.character_name}</Text>
                <Text style={styles.charMeta}>
                  Level {c.character_level} • ID #{c.char_id}
                </Text>
              </View>
              <Text style={styles.playBadge}>PLAY →</Text>
            </Pressable>
          ))}
          {characters.length === 0 && (
            <Text style={styles.emptyText}>
              Belum ada karakter. Buat Ninja pertama kamu di panel kanan →
            </Text>
          )}
        </ScrollView>
      </View>

      {/* Right: Create Character */}
      <View style={styles.rightPane}>
        <Text style={styles.title}>Create New Ninja</Text>

        <Text style={styles.label}>Ninja Name</Text>
        <TextInput
          style={styles.input}
          value={charName}
          onChangeText={setCharName}
          placeholder="e.g. ShinobiX"
          placeholderTextColor="#64748B"
        />

        <Text style={styles.label}>Gender</Text>
        <View style={styles.row}>
          <Pressable
            style={[styles.pill, gender === 0 && styles.pillActive]}
            onPress={() => setGender(0)}
          >
            <Text style={styles.pillText}>Male</Text>
          </Pressable>
          <Pressable
            style={[styles.pill, gender === 1 && styles.pillActive]}
            onPress={() => setGender(1)}
          >
            <Text style={styles.pillText}>Female</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Starting Element</Text>
        <View style={styles.elemRow}>
          {ELEMENTS.map((el) => (
            <Pressable
              key={el.id}
              style={[
                styles.elemChip,
                element === el.id && { backgroundColor: el.color, borderColor: '#FFF' },
              ]}
              onPress={() => setElement(el.id)}
            >
              <Text style={styles.pillText}>{el.name}</Text>
            </Pressable>
          ))}
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable style={styles.createBtn} onPress={handleCreate} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.createText}>Create & Enter Village</Text>
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
    padding: 14,
    gap: 14,
  },
  leftPane: {
    flex: 1.1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
  },
  rightPane: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  logoutBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  logoutText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '600',
  },
  list: { flex: 1 },
  listContent: { gap: 8 },
  charCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  charName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  charMeta: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  playBadge: {
    color: '#F59E0B',
    fontWeight: '800',
    fontSize: 12,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 12,
  },
  label: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: '#2563EB',
  },
  pillText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  elemRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  elemChip: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  errorText: {
    color: '#F87171',
    fontSize: 11,
    marginTop: 8,
  },
  createBtn: {
    marginTop: 14,
    backgroundColor: '#EA580C',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  createText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
});
