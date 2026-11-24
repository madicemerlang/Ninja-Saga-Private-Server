import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Socket } from 'socket.io-client';
import { createGlobalChatSocket } from '../api/sockets';
import { useAuthStore } from '../store/useAuthStore';

interface ChatMessageItem {
  id: string;
  senderName: string;
  senderId?: number;
  message: string;
  isSystem?: boolean;
}

interface OnlineUser {
  id: number;
  name: string;
}

export function ChatScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const chatSocketUrl = useAuthStore((s) => s.chatSocketUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!profile || !sessionKey) return;

    const socket = createGlobalChatSocket(serverUrl, chatSocketUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('auth', {
        character_id: profile.charId,
        session_key: sessionKey,
      });
      socket.emit('open-chatbox');
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('online-users', (payload: { total?: number; users?: OnlineUser[] }) => {
      if (Array.isArray(payload?.users)) {
        setOnlineUsers(payload.users);
      }
    });

    socket.on(
      'history',
      (hist: Array<{ character?: { id?: number; name?: string }; message?: string }>) => {
        if (!Array.isArray(hist)) return;
        const mapped: ChatMessageItem[] = hist.slice(-60).map((item, idx) => ({
          id: `hist-${idx}`,
          senderName: item.character?.name ?? 'Ninja',
          senderId: item.character?.id,
          message: String(item.message ?? ''),
        }));
        setMessages(mapped);
      }
    );

    socket.on(
      'message',
      (msg: { character?: { id?: number; name?: string }; message?: string }) => {
        setMessages((prev) => [
          ...prev.slice(-80),
          {
            id: `msg-${Date.now()}-${Math.random()}`,
            senderName: msg.character?.name ?? 'Ninja',
            senderId: msg.character?.id,
            message: String(msg.message ?? ''),
          },
        ]);
      }
    );

    socket.on('announcement', (ann: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `ann-${Date.now()}`,
          senderName: 'SYSTEM',
          message: String(ann),
          isSystem: true,
        },
      ]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl, chatSocketUrl, profile, sessionKey]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !socketRef.current) return;
    socketRef.current.emit('sendMessage', trimmed);
    setText('');
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigate('hub')}>
          <Text style={styles.backText}>← Village Hub</Text>
        </Pressable>
        <Text style={styles.title}>
          World Chat {connected ? '• LIVE' : '• Connecting...'}
        </Text>
        <Text style={styles.onlineBadge}>{onlineUsers.length} Online</Text>
      </View>

      <View style={styles.body}>
        {/* Chat Stream */}
        <View style={styles.chatPane}>
          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.msgList} contentContainerStyle={styles.msgContent}>
            {messages.map((m) => (
              <View key={m.id} style={styles.msgRow}>
                <Text
                  style={[
                    styles.msgSender,
                    m.isSystem && { color: '#F59E0B' },
                    m.senderId === profile?.charId && { color: '#38BDF8' },
                  ]}
                >
                  [{m.senderName}]:
                </Text>
                <Text style={styles.msgText}>{m.message}</Text>
              </View>
            ))}
            {messages.length === 0 && (
              <Text style={styles.emptyText}>No messages in Global Chat yet.</Text>
            )}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Type a message to all Shinobi..."
              placeholderTextColor="#64748B"
              onSubmitEditing={handleSend}
            />
            <Pressable style={styles.sendBtn} onPress={handleSend}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>

        {/* Online Ninjas Sidebar */}
        <View style={styles.usersPane}>
          <Text style={styles.sideTitle}>Online Ninjas ({onlineUsers.length})</Text>
          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
            {onlineUsers.map((u) => (
              <Text key={u.id} style={styles.userItem}>
                • {u.name}
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
  onlineBadge: {
    color: '#4ADE80',
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  chatPane: {
    flex: 1.8,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 10,
  },
  msgList: {
    flex: 1,
  },
  msgContent: {
    gap: 5,
    paddingBottom: 8,
  },
  msgRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  msgSender: {
    color: '#FACC15',
    fontSize: 12,
    fontWeight: '800',
  },
  msgText: {
    color: '#E2E8F0',
    fontSize: 12,
    flexShrink: 1,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
  },
  sendBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 8,
  },
  sendText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  usersPane: {
    flex: 0.7,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 10,
  },
  sideTitle: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
  },
  userItem: {
    color: '#CBD5E1',
    fontSize: 11,
    marginBottom: 4,
  },
});
