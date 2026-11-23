import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Socket } from 'socket.io-client';
import { getPvpSocket } from '../api/sockets';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
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
    <NinjaScrollWindow
      title="PvP Arena"
      bgSource={BUILDING_BGS.pvpArena}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <View style={styles.statusPill}>
          <Text style={styles.statusTxt}>
            {connected ? `🟢 ${activePlayers} Fighters Online` : '🟡 Connecting...'}
          </Text>
        </View>
      }
    >
      <View style={styles.body}>
        <View style={styles.leftCard}>
          <Text style={styles.cardTitle}>Fighter Profile</Text>
          <Text style={styles.meta}>Shinobi: {profile?.name}</Text>
          <Text style={styles.meta}>Level: {profile?.level}</Text>
          <Text style={styles.meta}>Weapon: {profile?.weapon}</Text>
          <Text style={styles.meta} numberOfLines={2}>
            Jutsu Loadout: {profile?.equippedSkills.join(', ')}
          </Text>

          <Pressable
            style={[styles.primaryBtn, queuing && { backgroundColor: '#B45309' }]}
            onPress={toggleMatchmaking}
            disabled={!connected}
          >
            <Text style={styles.btnText}>
              {queuing ? 'Cancel Matchmaking...' : '⚔️ Quick Matchmaking (1v1)'}
            </Text>
          </Pressable>

          <Pressable
            style={styles.practiceBtn}
            onPress={handleStartPractice}
            disabled={!connected}
          >
            <Text style={styles.btnText}>🥷 Spar with Shadow Rival (AI)</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            onPress={handleCreateRoom}
            disabled={!connected}
          >
            <Text style={styles.btnText}>🏮 Create Custom Room</Text>
          </Pressable>
        </View>

        <View style={styles.rightCard}>
          <Text style={styles.cardTitle}>Arena Battle Log</Text>
          <ScrollView style={styles.logBox}>
            {events.map((e, i) => (
              <Text key={i} style={styles.logLine}>
                {e}
              </Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  statusPill: {
    backgroundColor: '#3E2008',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusTxt: { color: '#FDE047', fontSize: 10.5, fontWeight: '900' },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  leftCard: {
    flex: 0.95,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 10,
  },
  rightCard: {
    flex: 1.35,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 10,
  },
  cardTitle: {
    color: NS_THEME.inkDark,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110, 62, 22, 0.35)',
    paddingBottom: 4,
  },
  meta: {
    color: NS_THEME.inkMid,
    fontSize: 11.5,
    fontWeight: '700',
    marginBottom: 4,
  },
  primaryBtn: {
    marginTop: 10,
    backgroundColor: NS_THEME.btnRed,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  practiceBtn: {
    marginTop: 7,
    backgroundColor: NS_THEME.btnPurple,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtn: {
    marginTop: 7,
    backgroundColor: NS_THEME.btnBlue,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '900',
  },
  logBox: {
    flex: 1,
    backgroundColor: NS_THEME.stageDark,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 8,
  },
  logLine: {
    color: '#FDE68A',
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 3,
  },
});
