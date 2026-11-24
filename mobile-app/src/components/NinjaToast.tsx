import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface NinjaToastProps {
  message: string | null;
  top?: number;
}

/**
 * Floating carved-wood & gold toast pill matching the Village Hub lock notification.
 * Uses absolute positioning + pointerEvents="none" so it never shifts screen layouts.
 */
export function NinjaToast({ message, top = 44 }: NinjaToastProps) {
  if (!message) return null;
  return (
    <View style={[styles.wrap, { top }]} pointerEvents="none">
      <View style={styles.pill}>
        <Text style={styles.txt}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 60,
  },
  pill: {
    backgroundColor: 'rgba(28, 16, 8, 0.94)',
    borderWidth: 1.5,
    borderColor: '#FACC15',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    maxWidth: '84%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 5,
    elevation: 10,
  },
  txt: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
});
