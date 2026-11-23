import type { ExpoConfig } from 'expo/config';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://192.168.101.170:8080';

const config: ExpoConfig = {
  name: 'Ninja Saga Mobile',
  slug: 'ninjasage-mobile',
  scheme: 'ninjasagemobile',
  version: '0.1.0',
  orientation: 'landscape',
  userInterfaceStyle: 'dark',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.ninjasage.mobile',
  },
  android: {
    package: 'com.ninjasage.mobile',
    versionCode: 1,
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE'],
    adaptiveIcon: {
      backgroundColor: '#0B1220',
    },
  },
  plugins: [
    'expo-asset',
    [
      'expo-screen-orientation',
      {
        initialOrientation: 'LANDSCAPE',
      },
    ],
  ],
  extra: {
    apiBaseUrl: API_BASE_URL,
  },
};

export default config;
