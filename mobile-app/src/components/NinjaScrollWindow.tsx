import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BuildingSceneBackdrop } from './BuildingSceneBackdrop';

/**
 * Authentic Ninja Saga / Ninja Sage parchment, bamboo & carved-wood UI palette.
 */
export const NS_THEME = {
  parchmentBg: 'rgba(235, 203, 141, 0.94)',
  parchmentCard: '#F6E4BA',
  parchmentCardAlt: '#ECD39B',
  parchmentSelected: '#FFF1C9',
  woodBorder: '#6E3E16',
  woodBorderDark: '#3E2008',
  goldTrim: '#D9A438',
  inkDark: '#2A1405',
  inkMid: '#5A3212',
  inkSoft: '#7A4C24',
  tabInactive: '#B88E50',
  tabActive: '#C85A17',
  btnGreen: '#2E8534',
  btnOrange: '#D95B16',
  btnRed: '#C62828',
  btnBlue: '#1D64A8',
  btnPurple: '#6D35A8',
  btnDisabled: '#8D7A62',
  stageDark: '#231309',
} as const;

interface NinjaScrollWindowProps {
  title: string;
  bgSource: ImageSourcePropType;
  onClose: () => void;
  rightContent?: React.ReactNode;
  headerCenter?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Authentic Ninja Saga in-building parchment & bamboo scroll window.
 * Features:
 * - Full-screen anime room interior behind the window
 * - Warm tan parchment panel with dark carved wood border
 * - Iconic hanging green bamboo title scroll with gold end-caps
 * - Classic glossy red ✕ close button on the top-right
 */
export function NinjaScrollWindow({
  title,
  bgSource,
  onClose,
  rightContent,
  headerCenter,
  children,
}: NinjaScrollWindowProps) {
  return (
    <SafeAreaView style={styles.root}>
      <BuildingSceneBackdrop source={bgSource} scrimOpacity={0.28} />

      <View style={styles.windowOuter}>
        {/* Top Row: Hanging Green Bamboo Scroll Header + Optional Center/Right + Red ✕ Close */}
        <View style={styles.topRow}>
          <View style={styles.bambooBanner}>
            <View style={styles.bambooCapLeft} />
            <View style={styles.bambooBody}>
              <Text style={styles.bambooTitle} numberOfLines={1}>
                {title}
              </Text>
            </View>
            <View style={styles.bambooCapRight} />
          </View>

          {headerCenter ? <View style={styles.centerSlot}>{headerCenter}</View> : null}

          <View style={styles.rightRow}>
            {rightContent ? <View style={styles.rightSlot}>{rightContent}</View> : null}
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeTxt}>✕</Text>
            </Pressable>
          </View>
        </View>

        {/* Inner Parchment Content Area */}
        <View style={styles.innerContent}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1B1108',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  windowOuter: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentBg,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: NS_THEME.woodBorderDark,
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.65,
    shadowRadius: 12,
    elevation: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  bambooBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -2,
  },
  bambooCapLeft: {
    width: 9,
    height: 30,
    borderRadius: 3,
    backgroundColor: '#E0B23A',
    borderWidth: 1.5,
    borderColor: '#3E2008',
  },
  bambooBody: {
    backgroundColor: '#2F6E24',
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#1B4314',
    paddingHorizontal: 14,
    paddingVertical: 4,
    minHeight: 26,
    justifyContent: 'center',
  },
  bambooCapRight: {
    width: 9,
    height: 30,
    borderRadius: 3,
    backgroundColor: '#E0B23A',
    borderWidth: 1.5,
    borderColor: '#3E2008',
  },
  bambooTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.4,
    textShadowColor: '#142E0F',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  centerSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rightSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#C62828',
    borderWidth: 2,
    borderColor: '#4A0E0E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 3,
    elevation: 4,
  },
  closeTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    marginTop: -1,
  },
  innerContent: {
    flex: 1,
    backgroundColor: 'rgba(247, 230, 190, 0.72)',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 8,
  },
});
