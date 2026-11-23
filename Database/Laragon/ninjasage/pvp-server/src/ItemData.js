'use strict';

const fs   = require('fs');
const path = require('path');

const CANDIDATE_PATHS = [
  '/game_data/library.json',
  path.resolve(__dirname, '../../public/game_data/library.json'),
  path.resolve(__dirname, '../../../public/game_data/library.json'),
];

const _weapons = {};

function load() {
  let loaded = false;
  for (const candidate of CANDIDATE_PATHS) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, 'utf8');
        const items = JSON.parse(raw);
        for (const it of items) {
          if (it && it.id) {
            _weapons[it.id] = {
              id: it.id,
              damage: parseInt(it.damage, 10) || 0,
              level: parseInt(it.level, 10) || 1,
              name: it.name || it.id,
              type: it.type || '',
            };
          }
        }
        console.log(`[ItemData] Loaded ${Object.keys(_weapons).length} items from ${candidate}`);
        loaded = true;
        break;
      }
    } catch (err) {
      console.warn(`[ItemData] Failed reading ${candidate}:`, err.message);
    }
  }

  if (!loaded) {
    console.warn('[ItemData] Warning: library.json could not be loaded. Default weapon stats will be used.');
  }
}

function getWeapon(weaponId) {
  return _weapons[weaponId] || null;
}

function getWeaponDamage(weaponId) {
  if (!weaponId) return 0;
  return _weapons[weaponId] ? _weapons[weaponId].damage : 0;
}

module.exports = {
  load,
  getWeapon,
  getWeaponDamage,
};
