'use strict';

const EventEmitter = require('events');
const db = require('./db');

class PracticeBotSocket extends EventEmitter {
  constructor(charId, character) {
    super();
    this.charId = charId;
    this.character = character;
    this.battleId = null;
    this.currentStats = { hp: 500, cp: 200 };
    this.skills = (character.equipment_skills || 'skill_01,skill_02')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    this.on('Battle.started', (data) => {
      this.battleId = data.battleId;
    });

    this.on('Battle.updateInfo', (data) => {
      if (Array.isArray(data?.stats)) {
        const myStat = data.stats.find(s => s.id === this.charId);
        if (myStat?.stat) {
          this.currentStats = { ...this.currentStats, ...myStat.stat };
        }
      }
    });

    this.on('Battle.action.ambush', (data) => {
      if (data?.id === this.charId) {
        this._takeTurn();
      }
    });

    this.on('Battle.action.weapon', (data) => this._onAction(data));
    this.on('Battle.action.skill',  (data) => this._onAction(data));
    this.on('Battle.action.charge', (data) => this._onAction(data));
  }

  _takeTurn() {
    setTimeout(() => {
      if (!this.battleId) return;

      const cp = this.currentStats.cp ?? 100;
      const canSkill = cp >= 35 && this.skills.length > 0;
      const roll = Math.random();

      if (canSkill && roll < 0.55) {
        const randomSkill = this.skills[Math.floor(Math.random() * this.skills.length)];
        this.emit('Battle.action.skill', {
          battle_id: this.battleId,
          skillId: randomSkill,
        });
      } else if (cp < 25 && roll < 0.6) {
        this.emit('Battle.action.charge', {
          battle_id: this.battleId,
        });
      } else {
        this.emit('Battle.action.weapon', {
          battle_id: this.battleId,
        });
      }
    }, 850);
  }

  _onAction(data) {
    // If it was the bot's own attack, wait for animation time then signal finished
    if (data?.id === this.charId) {
      setTimeout(() => {
        if (this.battleId) {
          this.emit('Battle.action.finished', { battle_id: this.battleId });
        }
      }, 1300);
    }
  }
}

async function createPracticeBot(botCharId = 2) {
  try {
    const row = await db.queryOne(
      `SELECT c.id, c.name, c.level, c.rank, c.gender,
              c.element_1, c.element_2, c.element_3,
              c.point_earth, c.point_water, c.point_wind, c.point_lightning, c.point_fire, c.point_free,
              c.equipment_weapon, c.equipment_back, c.equipment_accessory,
              c.equipment_skills, c.equipment_pet,
              c.talent_1, c.talent_2, c.talent_3,
              c.pvp_trophy, c.pvp_played, c.pvp_won, c.pvp_lost,
              c.hair_style, c.hair_color, c.skin_color,
              c.equipment_clothing
       FROM characters c
       WHERE c.id = ?`,
      [botCharId]
    );

    const char = row || {
      id: botCharId,
      name: 'ShadowRival',
      level: 10,
      rank: 1,
      gender: 0,
      element_1: 2,
      equipment_weapon: 'wpn_02',
      equipment_clothing: 'set_02_0',
      equipment_skills: 'skill_01,skill_02',
      hair_style: 'hair_02_0',
    };

    return new PracticeBotSocket(char.id, char);
  } catch (err) {
    console.warn('[PracticeBot] fallback to default dummy:', err.message);
    return new PracticeBotSocket(botCharId, {
      id: botCharId,
      name: 'ShadowRival',
      level: 10,
      rank: 1,
      gender: 0,
      element_1: 2,
      equipment_weapon: 'wpn_02',
      equipment_clothing: 'set_02_0',
      equipment_skills: 'skill_01,skill_02',
      hair_style: 'hair_02_0',
    });
  }
}

module.exports = { PracticeBotSocket, createPracticeBot };
