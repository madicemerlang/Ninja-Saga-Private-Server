import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoadingScreenOverlay } from './src/components/LoadingScreenOverlay';
import { AdvanceAcademyScreen } from './src/screens/AdvanceAcademyScreen';
import { BattleScreen } from './src/screens/BattleScreen';
import { CharSelectScreen } from './src/screens/CharSelectScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { DailyHubScreen } from './src/screens/DailyHubScreen';
import { EncyclopediaScreen } from './src/screens/EncyclopediaScreen';
import { ForgeScreen } from './src/screens/ForgeScreen';
import { HeadquarterScreen } from './src/screens/HeadquarterScreen';
import { HuntingHouseScreen } from './src/screens/HuntingHouseScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MissionScreen } from './src/screens/MissionScreen';
import { MyInventoryScreen } from './src/screens/MyInventoryScreen';
import { MyJutsuScreen } from './src/screens/MyJutsuScreen';
import { PetScreen } from './src/screens/PetScreen';
import { PetVillaScreen } from './src/screens/PetVillaScreen';
import { PvPBattleScreen } from './src/screens/PvPBattleScreen';
import { PvPLobbyScreen } from './src/screens/PvPLobbyScreen';
import { RecruitScreen } from './src/screens/RecruitScreen';
import { SenjutsuScreen } from './src/screens/SenjutsuScreen';
import { SocialHubScreen } from './src/screens/SocialHubScreen';
import { StagePocScreen } from './src/screens/StagePocScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { TalentScreen } from './src/screens/TalentScreen';
import { VillageHubScreen } from './src/screens/VillageHubScreen';
import { useAuthStore } from './src/store/useAuthStore';
import { preloadInitialResources } from './src/utils/resourcePreloader';

export default function App() {
  const screen = useAuthStore((s) => s.screen);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const [booting, setBooting] = useState(true);
  const [bootProgress, setBootProgress] = useState(0.06);
  const [bootLabel, setBootLabel] = useState('Initializing Ninja Village');

  useEffect(() => {
    let active = true;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {
      // Ignored on platforms where orientation lock is unsupported (e.g. desktop web)
    });

    // Real startup resource preloader (Village Map, Building Scenes, Game Data, Gear, Pets, NPCs, Ruffle & Character SWF)
    const minSplash = new Promise((r) => setTimeout(r, 900));
    Promise.all([
      minSplash,
      preloadInitialResources(serverUrl, ({ progress, label }) => {
        if (!active) return;
        setBootProgress(progress);
        setBootLabel(label);
      }),
    ]).finally(() => {
      if (active) {
        setBootProgress(1);
        setBooting(false);
      }
    });

    return () => {
      active = false;
    };
  }, [serverUrl]);

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
      case 'bag':
        return <MyInventoryScreen />;
      case 'myJutsu':
        return <MyJutsuScreen />;
      case 'stats':
        return <StatsScreen />;
      case 'pet':
        return <PetScreen mode="my" />;
      case 'petShop':
        return <PetScreen mode="shop" />;
      case 'petVilla':
        return <PetVillaScreen />;
      case 'academy':
        return <AdvanceAcademyScreen />;
      case 'hunting':
        return <HuntingHouseScreen />;
      case 'forge':
        return <ForgeScreen />;
      case 'talent':
        return <TalentScreen />;
      case 'headquarter':
        return <HeadquarterScreen />;
      case 'senjutsu':
        return <SenjutsuScreen />;
      case 'daily':
        return <DailyHubScreen />;
      case 'social':
        return <SocialHubScreen />;
      case 'recruit':
        return <RecruitScreen />;
      case 'encyclopedia':
        return <EncyclopediaScreen />;
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
      <LoadingScreenOverlay
        visible={booting}
        progress={bootProgress}
        subtitle={bootLabel}
      />
    </SafeAreaProvider>
  );
}
