import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Socket } from 'socket.io-client';
import { getPvpSocket } from '../api/sockets';
import { playClickSfx } from '../audio/audioManager';
import { useAuthStore } from '../store/useAuthStore';

export function PvPLobbyScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const pvpSocketUrl = useAuthStore((s) => s.pvpSocketUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setActivePvpBattle = useAuthStore((s) => s.setActivePvpBattle);
  const navigate = useAuthStore((s) => s.navigate);

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [activePlayers, setActivePlayers] = useState(0);
  const [queuing, setQueuing] = useState(false);
  const [events, setEvents] = useState<string[]>([]);

  const appendEvent = (line: string) => {
    setEvents((prev) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...prev].slice(0, 30));
  };

  useEffect(() => {
    if (!profile || !sessionKey) return;

    const socket = getPvpSocket(serverUrl, pvpSocketUrl);
    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      appendEvent(`Connected to /pvp (${socket.id})`);
      socket.emit('System.auth', {
        character_id: profile.charId,
        session_key: sessionKey,
      });
    };

    if (socket.connected) {
      handleConnect();
    } else {
      socket.on('connect', handleConnect);
    }

    socket.on('disconnect', (reason) => {
      setConnected(false);
      setQueuing(false);
      appendEvent(`Disconnected: ${reason}`);
    });

    socket.on('Client.characterInfo', (info: Record<string, unknown>) => {
      appendEvent(`Authenticated as ${String(info?.name ?? profile.name)} (HP ${String(info?.hp ?? '')})`);
    });

    socket.on('System.activePlayers', (count: number) => {
      setActivePlayers(Number(count) || 0);
    });

    socket.on('Notification.flash', (msg: string) => {
      appendEvent(`Notice: ${msg}`);
    });

    socket.on('Room.countdown.start', (data: { countdown: number }) => {
      appendEvent(`Match starting in ${data.countdown}s...`);
    });

    socket.on(
      'Battle.started',
      (data: {
        battleId: string;
        hostId: number;
        enemyId: number;
        isHost: boolean;
        background?: string;
      }) => {
        appendEvent(`Battle started! ID: ${data.battleId}`);
        const oppId = data.isHost ? data.enemyId : data.hostId;
        setActivePvpBattle({
          battleId: data.battleId,
          isHost: data.isHost,
          myCharId: profile.charId,
          opponentCharId: oppId,
          stage: data.background,
        });
        navigate('pvpBattle');
      }
    );

    socket.on('Notification.disconnect', (err: string) => {
      appendEvent(`Server rejected auth: ${err}`);
    });

    return () => {
      socket.off('connect', handleConnect);
      // Keep socket open if entering battle!
    };
  }, [serverUrl, pvpSocketUrl, profile, sessionKey, setActivePvpBattle, navigate]);

  const toggleMatchmaking = () => {
    if (!socketRef.current) return;
    playClickSfx(serverUrl);
    if (queuing) {
      socketRef.current.emit('Battle.stopMatchMaking');
      setQueuing(false);
      appendEvent('Left matchmaking queue');
    } else {
      socketRef.current.emit('Battle.startMatchMaking', { mode: '1v1' });
      setQueuing(true);
      appendEvent('Joined 1v1 Live PvP matchmaking queue...');
    }
  };

  const handleStartPractice = () => {
    if (!socketRef.current) return;
    playClickSfx(serverUrl);
    appendEvent('Starting practice sparring match with Shadow Rival...');
    socketRef.current.emit('Battle.startPractice');
  };

  const handleCreateRoom = () => {
    if (!socketRef.current || !profile) return;
    playClickSfx(serverUrl);
    socketRef.current.emit('Room.create', {
      name: `${profile.name}'s Dojo`,
      password: '',
      mode: '1v1',
    });
    appendEvent('Sent Room.create');
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigate('hub')}>
          <Text style={styles.backText}>← Village Hub</Text>
        </Pressable>
        <Text style={styles.title}>
          Live PvP Arena {connected ? '• ONLINE' : '• Connecting...'}
        </Text>
        <Text style={styles.onlineText}>{activePlayers} Fighters Online</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.leftCard}>
          <Text style={styles.cardTitle}>Fighter Profile</Text>
          <Text style={styles.meta}>Name: {profile?.name}</Text>
          <Text style={styles.meta}>Level: {profile?.level}</Text>
          <Text style={styles.meta}>Weapon: {profile?.weapon}</Text>
          <Text style={styles.meta}>
            Jutsu Loadout: {profile?.equippedSkills.join(', ')}
          </Text>

          <Pressable
            style={[styles.primaryBtn, queuing && { backgroundColor: '#D97706' }]}
            onPress={toggleMatchmaking}
            disabled={!connected}
          >
            <Text style={styles.btnText}>
              {queuing ? 'Cancel Matchmaking...' : 'Quick Matchmaking (1v1)'}
            </Text>
          </Pressable>

          <Pressable
            style={styles.practiceBtn}
            onPress={handleStartPractice}
            disabled={!connected}
          >
            <Text style={styles.btnText}>Spar with Shadow Rival (AI Practice)</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            onPress={handleCreateRoom}
            disabled={!connected}
          >
            <Text style={styles.btnText}>Create Custom Room</Text>
          </Pressable>
        </View>

        <View style={styles.rightCard}>
          <Text style={styles.cardTitle}>PvP Socket.IO Live Stream (:3000/pvp)</Text>
          <ScrollView style={styles.logBox}>
            {events.map((e, i) => (
              <Text key={i} style={styles.logLine}>
                {e}
              </Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#070E1A',
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  backText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  onlineText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  leftCard: {
    flex: 0.9,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
  },
  rightCard: {
    flex: 1.4,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
  },
  cardTitle: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  meta: {
    color: '#E2E8F0',
    fontSize: 12,
    marginBottom: 5,
  },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  practiceBtn: {
    marginTop: 8,
    backgroundColor: '#7C3AED',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtn: {
    marginTop: 8,
    backgroundColor: '#2563EB',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  logBox: {
    flex: 1,
    backgroundColor: '#020617',
    borderRadius: 8,
    padding: 8,
  },
  logLine: {
    color: '#86EFAC',
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 3,
  },
});
