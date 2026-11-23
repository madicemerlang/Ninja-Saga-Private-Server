import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AdvanceAcademyScreen } from './src/screens/AdvanceAcademyScreen';
import { BattleScreen } from './src/screens/BattleScreen';
import { CharSelectScreen } from './src/screens/CharSelectScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { ForgeScreen } from './src/screens/ForgeScreen';
import { HuntingHouseScreen } from './src/screens/HuntingHouseScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MissionScreen } from './src/screens/MissionScreen';
import { PetScreen } from './src/screens/PetScreen';
import { PvPBattleScreen } from './src/screens/PvPBattleScreen';
import { PvPLobbyScreen } from './src/screens/PvPLobbyScreen';
import { StagePocScreen } from './src/screens/StagePocScreen';
import { TalentScreen } from './src/screens/TalentScreen';
import { VillageHubScreen } from './src/screens/VillageHubScreen';
import { useAuthStore } from './src/store/useAuthStore';

export default function App() {
  const screen = useAuthStore((s) => s.screen);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {
      // Ignored on platforms where orientation lock is unsupported (e.g. desktop web)
    });
  }, []);

  const renderScreen = () => {
    switch (screen) {
      case 'login':
        return <LoginScreen />;
      case 'charSelect':
        return <CharSelectScreen />;
      case 'hub':
        return <VillageHubScreen />;
      case 'missions':
        return <MissionScreen />;
      case 'battle':
        return <BattleScreen />;
      case 'inventory':
        return <InventoryScreen />;
      case 'pet':
        return <PetScreen />;
      case 'academy':
        return <AdvanceAcademyScreen />;
      case 'hunting':
        return <HuntingHouseScreen />;
      case 'forge':
        return <ForgeScreen />;
      case 'talent':
        return <TalentScreen />;
      case 'chat':
        return <ChatScreen />;
      case 'pvp':
        return <PvPLobbyScreen />;
      case 'pvpBattle':
        return <PvPBattleScreen />;
      case 'poc':
      default:
        return <StagePocScreen />;
    }
  };

  return (
    <SafeAreaProvider>
      <StatusBar hidden style="light" />
      {renderScreen()}
    </SafeAreaProvider>
  );
}
