import React from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

export const BUILDING_BGS = {
  missionRoom: require('../../assets/bg_mission_room.jpg'),
  academy: require('../../assets/bg_academy.jpg'),
  pvpArena: require('../../assets/bg_pvp_arena.jpg'),
  talentHall: require('../../assets/bg_talent_hall.jpg'),
  blacksmith: require('../../assets/bg_blacksmith.jpg'),
  ninjaShop: require('../../assets/bg_ninja_shop.jpg'),
  petShop: require('../../assets/bg_pet_shop.jpg'),
  huntingHouse: require('../../assets/bg_hunting_house.jpg'),
} as const;

interface BuildingSceneBackdropProps {
  source: ImageSourcePropType;
  scrimOpacity?: number;
}

/**
 * Full-screen 16:9 anime interior artwork behind translucent Ninja Saga building UI panels.
 */
export function BuildingSceneBackdrop({
  source,
  scrimOpacity = 0.42,
}: BuildingSceneBackdropProps) {
  return (
    <View style={styles.wrap} pointerEvents="none">
      <Image source={source} style={styles.img} resizeMode="cover" />
      <View style={[styles.scrim, { backgroundColor: `rgba(8, 12, 22, ${scrimOpacity})` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
  },
  img: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
});
