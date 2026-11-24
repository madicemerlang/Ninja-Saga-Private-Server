import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MobileApiClient, type BattleStartResponse } from '../api/client';
import { loadGameData, type EnemyDef } from '../api/gameData';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import {
  ExamMiniGameModal,
  type ExamDifficulty,
  type ExamMiniGameType,
} from '../components/ExamMiniGames';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
import { useAuthStore } from '../store/useAuthStore';

type ExamTab = 'chunin' | 'jounin' | 'specialJounin' | 'ninjaTutor';

interface ExamStageSpec {
  title: string;
  desc: string;
  kind: 'minigame' | 'battle';
  miniGame?: ExamMiniGameType;
  enemies?: string[];
  bg?: string;
  isBoss?: boolean;
}

interface ExamStageRow extends ExamStageSpec {
  index: number;
  stageId: number;
  status: number; // 0 = locked, 1 = ready, 2 = cleared
  claimed: boolean;
}

interface ExamRewardPreview {
  icon: string;
  label: string;
}

interface ExamConfig {
  key: ExamTab;
  label: string;
  service: string;
  promoteMethod: string;
  reqLevel: number;
  reqRank: number;
  reqRankLabel: string;
  targetRank: number;
  targetRankLabel: string;
  stageOffset: number;
  stageCount: number;
  rewards: ExamRewardPreview[];
  stages: ExamStageSpec[];
}

const RANK_NAMES: Record<number, string> = {
  1: 'Genin',
  2: 'Genin',
  3: 'Chunin',
  4: 'Chunin',
  5: 'Jounin',
  6: 'Jounin',
  7: 'Special Jounin',
  8: 'Ninja Tutor',
  9: 'Senior Ninja Tutor',
  10: 'Sage',
};

const SPECIAL_JOUNIN_CLASSES = [
  {
    id: 'skill_4000',
    name: 'Medical Class',
    icon: '💚',
    desc: 'Recover team HP in battle. Higher level heals more HP (1x/battle).',
  },
  {
    id: 'skill_4001',
    name: 'Sensation Class',
    icon: '✨',
    desc: 'Remove all negative statuses even while stunned or restricted (1x/battle).',
  },
  {
    id: 'skill_4002',
    name: 'Intelligence Class',
    icon: '🔍',
    desc: 'Scout enemy HP/CP and reveal 4 random enemy Jutsu.',
  },
  {
    id: 'skill_4003',
    name: 'Offense Class',
    icon: '🔥',
    desc: 'Collect Chakra Balls each turn to unleash +150% burst damage (1x/battle).',
  },
  {
    id: 'skill_4004',
    name: 'Assault Class',
    icon: '⚔️',
    desc: 'Ignore target status and deal massive execute damage based on remaining HP.',
  },
];

const REWARD_LABEL_MAP: Record<string, string> = {
  set_150_0: '🥋 Chunin Costume (Male)',
  set_150_1: '🥋 Chunin Costume (Female)',
  set_150: '🥋 Chunin Costume',
  wpn_794: '⚔️ Chunin Nunchaku (Lv.20)',
  skill_109: '🔥 Kinjutsu: Spirit Touch',
  skill_176: '💧 Kinjutsu: Serene Mind',
  skill_345: '🌀 Kinjutsu: Five Elements Consuming Seal',
  skill_4000: '💚 Medical Class Jutsu',
  skill_4001: '✨ Sensation Class Jutsu',
  skill_4002: '🔍 Intelligence Class Jutsu',
  skill_4003: '🔥 Offense Class Jutsu',
  skill_4004: '⚔️ Assault Class Jutsu',
  set_588_0: '🥋 Tensai Special Jounin Suit (Male)',
  set_588_1: '🥋 Tensai Special Jounin Suit (Female)',
  set_588: '🥋 Tensai Special Jounin Suit',
  wpn_988: '🗡️ Bloodstain Blade (Lv.80)',
  set_942_0: '👘 Senior Ninja Tutor Suit (Male)',
  set_942_1: '👘 Senior Ninja Tutor Suit (Female)',
  set_942: '👘 Senior Ninja Tutor Suit',
  back_430: '🪽 Light of Eternal (Back)',
  material_01: '🟣 Dark Magatama',
  material_02: '🟢 Green Magatama',
  material_03: '🔵 Blue Magatama',
  material_04: '🟣 Purple Magatama',
  material_05: '🟡 Yellow Magatama',
};

function formatRewardCode(code: string): string {
  if (code.startsWith('tokens_')) {
    return `💎 ${code.replace('tokens_', '')} Tokens`;
  }
  if (code.includes(':')) {
    const [id, qty] = code.split(':');
    const base = REWARD_LABEL_MAP[id] ?? id;
    return `${base} x${qty}`;
  }
  return REWARD_LABEL_MAP[code] ?? code;
}

const EXAMS: ExamConfig[] = [
  {
    key: 'chunin',
    label: 'Chunin Exam',
    service: 'ChuninExamService',
    promoteMethod: 'promoteToChunin',
    reqLevel: 20,
    reqRank: 1,
    reqRankLabel: 'Genin',
    targetRank: 3,
    targetRankLabel: 'Chunin',
    stageOffset: 1,
    stageCount: 5,
    rewards: [
      { icon: '🥋', label: 'Chunin Costume' },
      { icon: '⚔️', label: 'Chunin Nunchaku' },
      { icon: '🔥', label: 'Kinjutsu: Spirit Touch' },
      { icon: '💎', label: '200 Tokens' },
    ],
    stages: [
      {
        title: 'Stage 1: Written Exam',
        desc: 'Answer 4/5 shinobi questions correctly before time expires.',
        kind: 'minigame',
        miniGame: 'quiz',
      },
      {
        title: 'Stage 2: Forest of Death — Scroll Hunt',
        desc: 'Defeat Water & Toxic Village Genin to seize the Heaven & Earth Scrolls.',
        kind: 'battle',
        enemies: ['ene_29', 'ene_31'],
        bg: 'mission_03',
      },
      {
        title: 'Stage 3: Preliminary Combat',
        desc: 'Overcome the Rebel Ninja duo in the preliminary arena.',
        kind: 'battle',
        enemies: ['ene_48', 'ene_49'],
        bg: 'mission_03',
      },
      {
        title: 'Stage 4: Elemental Hand-Seal Trial',
        desc: 'Memorize and weave 3 rounds of Zodiac Hand Seals accurately.',
        kind: 'minigame',
        miniGame: 'handseal',
      },
      {
        title: 'Stage 5: Final Chunin Duel — Kanku',
        desc: 'Defeat Exam Boss Kanku in a 1-on-1 Chunin finals match!',
        kind: 'battle',
        enemies: ['ene_67'],
        bg: 'mission_24',
        isBoss: true,
      },
    ],
  },
  {
    key: 'jounin',
    label: 'Jounin Exam',
    service: 'JouninExamService',
    promoteMethod: 'promoteToJounin',
    reqLevel: 40,
    reqRank: 3,
    reqRankLabel: 'Chunin',
    targetRank: 5,
    targetRankLabel: 'Jounin',
    stageOffset: 6,
    stageCount: 5,
    rewards: [
      { icon: '💧', label: 'Kinjutsu: Serene Mind' },
      { icon: '💎', label: '200 Tokens' },
      { icon: '🔮', label: '5x All 5 Magatamas' },
    ],
    stages: [
      {
        title: 'Stage 1: Jounin Tactical Assessment',
        desc: 'Pass the Jounin-level shinobi tactics & status written test (4/5).',
        kind: 'minigame',
        miniGame: 'quiz',
      },
      {
        title: 'Stage 2: Hidden Patrol Ambush',
        desc: 'Defeat the Soil Village Chunin & Stealth Assassin patrol.',
        kind: 'battle',
        enemies: ['ene_52', 'ene_77'],
        bg: 'mission_133',
      },
      {
        title: 'Stage 3: Chakra Control Reflex Trial',
        desc: 'Release chakra inside the golden seal zone 4 times to prove mastery.',
        kind: 'minigame',
        miniGame: 'chakra',
      },
      {
        title: 'Stage 4: Elite Jounin Gauntlet',
        desc: 'Face Jounin examiners Kiyoshi & Sen Ryo in a 2v1 trial.',
        kind: 'battle',
        enemies: ['ene_95', 'ene_96'],
        bg: 'mission_135',
      },
      {
        title: 'Stage 5: Final Evaluation — Takeshi',
        desc: 'Defeat Master Examiner Takeshi to earn Jounin rank!',
        kind: 'battle',
        enemies: ['ene_97'],
        bg: 'mission_136',
        isBoss: true,
      },
    ],
  },
  {
    key: 'specialJounin',
    label: 'Special Jounin',
    service: 'SpecialJouninExamService',
    promoteMethod: 'promoteToSpecialJounin',
    reqLevel: 60,
    reqRank: 5,
    reqRankLabel: 'Jounin',
    targetRank: 7,
    targetRankLabel: 'Special Jounin',
    stageOffset: 11,
    stageCount: 13,
    rewards: [
      { icon: '🥋', label: 'Tensai Special Jounin Suit' },
      { icon: '🌀', label: 'Kinjutsu: Five Elements Seal' },
      { icon: '⭐', label: 'Choice of 5 Class Jutsu' },
    ],
    stages: [
      {
        title: 'Stage 1: Special Jounin Doctrine',
        desc: 'Pass the Special Jounin Class & strategy exam (4/5).',
        kind: 'minigame',
        miniGame: 'quiz',
      },
      {
        title: 'Stage 2: Vanguard Interception',
        desc: 'Eliminate the Soil Jounin Elite squad.',
        kind: 'battle',
        enemies: ['ene_110', 'ene_111'],
        bg: 'mission_03',
      },
      {
        title: 'Stage 3: Precision Chakra Seal',
        desc: 'Focus chakra precisely inside the narrowing golden zone.',
        kind: 'minigame',
        miniGame: 'chakra',
      },
      {
        title: 'Stage 4: Shadow Clone Scroll Maze',
        desc: 'Match all 6 hidden shinobi scroll pairs before time runs out.',
        kind: 'minigame',
        miniGame: 'scrollpair',
      },
      {
        title: 'Stage 5: Lightning Border Patrol',
        desc: 'Defeat Lightning Village Jounin & Mountain Bandit Leader.',
        kind: 'battle',
        enemies: ['ene_113', 'ene_112'],
        bg: 'mission_08',
      },
      {
        title: 'Stage 6: Forbidden Hand-Seal Weave',
        desc: 'Reproduce 3 advanced Zodiac Hand-Seal sequences.',
        kind: 'minigame',
        miniGame: 'handseal',
      },
      {
        title: 'Stage 7: Toxic Village Ambush',
        desc: 'Defeat Toxic Village Jounin & Chunin escorts.',
        kind: 'battle',
        enemies: ['ene_131', 'ene_132'],
        bg: 'mission_33',
      },
      {
        title: 'Stage 8: Barrier Chakra Sync',
        desc: 'Break the barrier with 4 accurate chakra releases.',
        kind: 'minigame',
        miniGame: 'chakra',
      },
      {
        title: 'Stage 9: Undead Puppet Chamber',
        desc: 'Destroy the twin Undead Puppets guarding the inner sanctum.',
        kind: 'battle',
        enemies: ['ene_144', 'ene_145'],
        bg: 'mission_24',
      },
      {
        title: 'Stage 10: Illusion Scroll Decryption',
        desc: 'Dispel the genjutsu by matching all 6 scroll pairs.',
        kind: 'minigame',
        miniGame: 'scrollpair',
      },
      {
        title: 'Stage 11: Duel of Mudo',
        desc: 'Defeat Special Jounin guardian Mudo in combat.',
        kind: 'battle',
        enemies: ['ene_99'],
        bg: 'mission_135',
        isBoss: true,
      },
      {
        title: 'Stage 12: Duel of Kyotaro',
        desc: 'Overcome master swordsman Kyotaro.',
        kind: 'battle',
        enemies: ['ene_100'],
        bg: 'mission_136',
        isBoss: true,
      },
      {
        title: 'Stage 13: Final Boss — Yamata no Orochi',
        desc: 'Vanquish Yamata no Orochi to earn Special Jounin Class!',
        kind: 'battle',
        enemies: ['ene_101'],
        bg: 'mission_83',
        isBoss: true,
      },
    ],
  },
  {
    key: 'ninjaTutor',
    label: 'Ninja Tutor',
    service: 'NinjaTutorExamService',
    promoteMethod: 'promoteToNinjaTutor',
    reqLevel: 80,
    reqRank: 7,
    reqRankLabel: 'Special Jounin',
    targetRank: 9,
    targetRankLabel: 'Senior Ninja Tutor',
    stageOffset: 24,
    stageCount: 12,
    rewards: [
      { icon: '🗡️', label: 'Bloodstain Blade (Lv.80)' },
      { icon: '👘', label: 'Senior Ninja Tutor Suit' },
      { icon: '🪽', label: 'Light of Eternal (Back)' },
    ],
    stages: [
      {
        title: 'Chapter 1: Path of the Mentor',
        desc: 'Pass the Senior Ninja Tutor Grandmaster written examination.',
        kind: 'minigame',
        miniGame: 'quiz',
      },
      {
        title: 'Chapter 2: Discipline of Chakra',
        desc: 'Achieve 4 flawless chakra control timings.',
        kind: 'minigame',
        miniGame: 'chakra',
      },
      {
        title: 'Chapter 3: Trial of Kojima',
        desc: 'Defeat Master Kojima in a Lv.80 shinobi duel.',
        kind: 'battle',
        enemies: ['ene_45'],
        bg: 'mission_01',
      },
      {
        title: 'Chapter 4: Countering Genjutsu',
        desc: 'Break the illusion by pairing all 6 secret scrolls.',
        kind: 'minigame',
        miniGame: 'scrollpair',
      },
      {
        title: 'Chapter 5: Five Elements Hand Seals',
        desc: 'Complete 3 Grandmaster Zodiac Hand-Seal combinations.',
        kind: 'minigame',
        miniGame: 'handseal',
      },
      {
        title: 'Chapter 6: Shikigami Dori',
        desc: 'Subdue the ancient spirit Shikigami Dori.',
        kind: 'battle',
        enemies: ['ene_190'],
        bg: 'mission_26',
        isBoss: true,
      },
      {
        title: 'Chapter 7: Kari Mori Duel',
        desc: 'Defeat phantom assassin Kari Mori.',
        kind: 'battle',
        enemies: ['ene_196'],
        bg: 'mission_133',
      },
      {
        title: 'Chapter 8: Forbidden Seal Timing',
        desc: 'Lock down the forbidden seal with 4 precision strikes.',
        kind: 'minigame',
        miniGame: 'chakra',
      },
      {
        title: 'Chapter 9: Hanasikukozo',
        desc: 'Vanquish Hanasikukozo in the sacred forest.',
        kind: 'battle',
        enemies: ['ene_281'],
        bg: 'mission_03',
      },
      {
        title: 'Chapter 10: Snow Monster Summit',
        desc: 'Endure the blizzard and defeat the Snow Monster.',
        kind: 'battle',
        enemies: ['ene_500'],
        bg: 'mission_135',
      },
      {
        title: 'Chapter 11: Grandmaster Seal Trial',
        desc: 'Weave the final Zodiac Hand-Seal rite before the Kage Council.',
        kind: 'minigame',
        miniGame: 'handseal',
      },
      {
        title: 'Chapter 12: Final Boss — Demon King',
        desc: 'Defeat the Demon King to become a Senior Ninja Tutor!',
        kind: 'battle',
        enemies: ['ene_392'],
        bg: 'mission_136',
        isBoss: true,
      },
    ],
  },
];

function getStageBadge(row: ExamStageRow): { icon: string; label: string; color: string } {
  if (row.kind === 'battle') {
    return row.isBoss
      ? { icon: '💀', label: 'BOSS DUEL', color: '#991B1B' }
      : { icon: '⚔️', label: 'COMBAT', color: '#B45309' };
  }
  switch (row.miniGame) {
    case 'quiz':
      return { icon: '📜', label: 'WRITTEN QUIZ', color: '#1D4ED8' };
    case 'handseal':
      return { icon: '🙌', label: 'HAND SEALS', color: '#7C3AED' };
    case 'chakra':
      return { icon: '⚡', label: 'CHAKRA TIMING', color: '#0369A1' };
    case 'scrollpair':
      return { icon: '⛩️', label: 'SCROLL MATCH', color: '#0F766E' };
    default:
      return { icon: '🎯', label: 'MINI-GAME', color: '#4338CA' };
  }
}

export function HeadquarterScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useAuthStore((s) => s.navigate);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const setActiveBattle = useAuthStore((s) => s.setActiveBattle);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [tab, setTab] = useState<ExamTab>('chunin');
  const [loading, setLoading] = useState(true);
  const [busyStage, setBusyStage] = useState<number | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [stages, setStages] = useState<ExamStageRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // Active mini-game modal
  const [activeMiniGame, setActiveMiniGame] = useState<{
    row: ExamStageRow;
    exam: ExamConfig;
  } | null>(null);

  // Special Jounin Class selection modal
  const [showClassModal, setShowClassModal] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState('skill_4000');

  // Promotion Celebration modal
  const [promoCelebration, setPromoCelebration] = useState<{
    rankLabel: string;
    rewards: string[];
  } | null>(null);

  const availableExams = useMemo(() => {
    if (!profile) return [];
    return EXAMS.filter((ex) => profile.level >= ex.reqLevel && profile.rank >= ex.reqRank);
  }, [profile]);

  const activeExam = useMemo(
    () => availableExams.find((e) => e.key === tab) ?? availableExams[0] ?? null,
    [availableExams, tab]
  );

  useEffect(() => {
    if (availableExams.length > 0 && !availableExams.some((e) => e.key === tab)) {
      setTab(availableExams[0].key);
    }
  }, [availableExams, tab]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  const refreshProfile = useCallback(async () => {
    if (!profile || !sessionKey) return;
    try {
      const fresh = await api.getCharacter(profile.charId, sessionKey);
      setProfileFromRaw(profile.charId, fresh);
    } catch {
      // ignore
    }
  }, [api, profile, sessionKey, setProfileFromRaw]);

  const loadExamData = useCallback(async () => {
    if (!profile || !sessionKey || !activeExam) {
      setStages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.rpc<{
        status?: number;
        data?: Array<{ status?: string | number; claimed?: string | number | boolean }>;
        error?: string;
      }>(
        activeExam.service,
        'getData',
        [sessionKey, profile.charId],
        { sessionKey, charId: profile.charId }
      );
      const rawList = Array.isArray(res.data?.data) ? res.data.data : [];
      const mapped: ExamStageRow[] = Array.from({ length: activeExam.stageCount }, (_, i) => {
        const entry = rawList[i];
        const spec = activeExam.stages[i] ?? {
          title: `Stage ${i + 1}`,
          desc: `Exam Stage ${i + 1} of ${activeExam.stageCount}`,
          kind: 'minigame' as const,
          miniGame: 'quiz' as const,
        };
        return {
          ...spec,
          index: i,
          stageId: activeExam.stageOffset + i,
          status: entry ? Number(entry.status ?? 0) : i === 0 ? 1 : 0,
          claimed: Boolean(
            entry && (entry.claimed === true || entry.claimed === '1' || entry.claimed === 1)
          ),
        };
      });
      setStages(mapped);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to load exam data.');
    } finally {
      setLoading(false);
    }
  }, [api, activeExam, profile, sessionKey]);

  useEffect(() => {
    loadExamData();
  }, [loadExamData]);

  if (!profile || !sessionKey) return null;

  const meetsLevel = activeExam ? profile.level >= activeExam.reqLevel : false;
  const meetsRank = activeExam ? profile.rank >= activeExam.reqRank : false;
  const alreadyPromoted = activeExam ? profile.rank >= activeExam.targetRank : false;
  const clearedCount = stages.filter((s) => s.status >= 2).length;
  const allCleared = stages.length > 0 && clearedCount === stages.length;

  const handleTakeStage = async (row: ExamStageRow) => {
    if (!activeExam) return;
    if (!meetsLevel) {
      setNotice(`Requires Level ${activeExam.reqLevel} (Current: Lv.${profile.level})`);
      return;
    }
    if (!meetsRank) {
      setNotice(`Requires ${activeExam.reqRankLabel} rank first.`);
      return;
    }

    setBusyStage(row.stageId);
    try {
      const startRes = await api.rpc<{ status?: number; hash?: string; result?: string; error?: string }>(
        activeExam.service,
        'startStage',
        [sessionKey, profile.charId, row.stageId],
        { sessionKey, charId: profile.charId }
      );
      if (startRes.data?.status !== 1) {
        setNotice(startRes.data?.result || startRes.data?.error || 'Cannot start this stage.');
        return;
      }

      if (row.kind === 'minigame') {
        // Open authentic interactive Ninja Saga mini-game!
        setActiveMiniGame({ row, exam: activeExam });
        return;
      }

      // Combat Stage -> launch REAL 36 FPS BattleScreen with authentic exam enemies!
      const gd = await loadGameData(serverUrl);
      const enemyIds = row.enemies && row.enemies.length > 0 ? row.enemies : ['ene_29'];
      const battleEnemies = enemyIds.map((eid) => {
        const def: EnemyDef | undefined = gd.enemiesById[eid];
        const lv = Math.max(1, Number(def?.level || activeExam.reqLevel));
        const rawHp = Number(def?.hp || 0);
        // Many mission enemies have hp:0 in enemy.json (meaning dynamically scaled to level)
        const scaledHp = rawHp > 10 ? rawHp : 160 + lv * 26;
        const scaledCp = Math.max(120, Number(def?.cp || 0) || 120 + lv * 14);
        const scaledAgi = Math.max(10, Number(def?.agility || 0) || 10 + Math.round(lv * 1.1));
        return {
          id: eid,
          name: def?.name || eid,
          level: lv,
          hp: scaledHp,
          cp: scaledCp,
          agility: scaledAgi,
          dodge: Number(def?.dodge || 5),
          critical: Number(def?.critical || 6),
          accuracy: Number(def?.accuracy || 5),
        };
      });

      const battlePayload: BattleStartResponse = {
        status: 1,
        token: startRes.data?.hash || `exam_${row.stageId}_${Date.now()}`,
        mission: {
          id: `exam_${activeExam.key}_${row.stageId}`,
          name: `${activeExam.label} — ${row.title}`,
          bg: row.bg || 'mission_03',
          req_lvl: activeExam.reqLevel,
          reward_gold: 0,
          reward_xp: 0,
        },
        examContext: {
          service: activeExam.service,
          stageId: row.stageId,
          stageTitle: row.title,
          examLabel: activeExam.label,
        },
        enemies: battleEnemies,
      };
      setActiveBattle(battlePayload);
      navigate('battle');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Exam stage failed to start.');
    } finally {
      setBusyStage(null);
    }
  };

  const handleCompleteMiniGame = async () => {
    if (!activeMiniGame) return;
    const { row, exam } = activeMiniGame;
    setActiveMiniGame(null);
    setBusyStage(row.stageId);
    try {
      const finRes = await api.rpc<{ status?: number; result?: string; error?: string }>(
        exam.service,
        'finishStage',
        [sessionKey, profile.charId, row.stageId],
        { sessionKey, charId: profile.charId }
      );
      if (finRes.data?.status === 1) {
        setNotice(`✓ Cleared ${row.title}!`);
        await Promise.all([loadExamData(), refreshProfile()]);
      } else {
        setNotice(finRes.data?.result || finRes.data?.error || 'Stage completion failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to record stage clear.');
    } finally {
      setBusyStage(null);
    }
  };

  const executePromotion = async (classSkillId?: string) => {
    if (!activeExam) return;
    setPromoting(true);
    try {
      const args =
        activeExam.key === 'specialJounin'
          ? [sessionKey, profile.charId, classSkillId || selectedClassId]
          : [sessionKey, profile.charId];
      const res = await api.rpc<{
        status?: number;
        rewards?: string[];
        result?: string;
        error?: string;
      }>(activeExam.service, activeExam.promoteMethod, args, {
        sessionKey,
        charId: profile.charId,
      });
      if (res.data?.status === 1) {
        const rewardList = Array.isArray(res.data.rewards) ? res.data.rewards : [];
        setShowClassModal(false);
        setPromoCelebration({
          rankLabel: activeExam.targetRankLabel,
          rewards: rewardList,
        });
        await Promise.all([loadExamData(), refreshProfile()]);
      } else {
        setNotice(res.data?.result || res.data?.error || 'Promotion failed.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Promotion failed.');
    } finally {
      setPromoting(false);
    }
  };

  const handlePromotePress = () => {
    if (!activeExam) return;
    if (activeExam.key === 'specialJounin' && !alreadyPromoted) {
      setShowClassModal(true);
    } else {
      executePromotion();
    }
  };

  const rankLabel = RANK_NAMES[profile.rank] ?? `Rank ${profile.rank}`;

  return (
    <NinjaScrollWindow
      title="Headquarter — Rank Exams"
      bgSource={BUILDING_BGS.missionRoom}
      onClose={() => navigate('hub')}
      rightContent={
        <View style={styles.rankBadge}>
          <Text style={styles.rankBadgeTxt}>
            Rank: {rankLabel} • Lv.{profile.level}
          </Text>
        </View>
      }
    >
      <View style={styles.container}>
        {availableExams.length === 0 || !activeExam ? (
          <View style={styles.center}>
            <View style={styles.emptyExamCard}>
              <Text style={styles.emptyExamIcon}>🏯</Text>
              <Text style={styles.emptyExamTitle}>No Rank Exams Available Yet</Text>
              <Text style={styles.emptyExamSub}>
                Reach Level 20 as a Genin to unlock the Chunin Exam!
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/* Exam Category Tabs */}
            <View style={styles.tabRow}>
              {availableExams.map((ex) => {
                const active = ex.key === tab;
                const passed = profile.rank >= ex.targetRank;
                return (
                  <Pressable
                    key={ex.key}
                    style={[styles.tabBtn, active && styles.tabBtnActive]}
                    onPress={() => setTab(ex.key)}
                  >
                    <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>
                      {passed ? '✓ ' : ''}
                      {ex.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <NinjaToast message={notice} top={6} />

            {/* Requirement, Progress & Authentic Promotion Rewards Summary */}
            <View style={styles.summaryBar}>
              <View style={styles.summaryLeft}>
                <Text style={styles.summaryTitle}>
                  {activeExam.label} ({clearedCount}/{activeExam.stageCount} Cleared)
                </Text>
                <View style={styles.rewardChipRow}>
                  <Text style={styles.rewardPrefix}>Rewards:</Text>
                  {activeExam.rewards.map((rw, idx) => (
                    <View key={idx} style={styles.rewardChip}>
                      <Text style={styles.rewardChipTxt}>
                        {rw.icon} {rw.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              {alreadyPromoted ? (
                <View style={styles.promotedPill}>
                  <Text style={styles.promotedTxt}>★ {activeExam.targetRankLabel.toUpperCase()}</Text>
                </View>
              ) : allCleared ? (
                <Pressable
                  style={[styles.promoteBtn, promoting && styles.btnDisabled]}
                  disabled={promoting}
                  onPress={handlePromotePress}
                >
                  <Text style={styles.promoteBtnTxt}>
                    {promoting ? 'Promoting...' : `🏆 Promote to ${activeExam.targetRankLabel}`}
                  </Text>
                </Pressable>
              ) : (
                <View
                  style={[
                    styles.reqPill,
                    meetsLevel && meetsRank ? styles.reqPillOk : styles.reqPillLock,
                  ]}
                >
                  <Text style={styles.reqPillTxt}>
                    {meetsLevel && meetsRank
                      ? `LV.${activeExam.reqLevel} ELIGIBLE`
                      : `NEED LV.${activeExam.reqLevel}`}
                  </Text>
                </View>
              )}
            </View>

            {/* Stage List */}
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
              </View>
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.stageList}
              >
                {stages.map((row) => {
                  const cleared = row.status >= 2;
                  const unlocked = row.status === 1;
                  const busy = busyStage === row.stageId;
                  const badge = getStageBadge(row);
                  return (
                    <View
                      key={row.stageId}
                      style={[
                        styles.stageCard,
                        cleared && styles.stageCardCleared,
                        unlocked && styles.stageCardReady,
                      ]}
                    >
                      <View style={styles.stageNumBox}>
                        <Text style={styles.stageNumTxt}>{row.index + 1}</Text>
                      </View>
                      <View style={styles.stageInfo}>
                        <View style={styles.stageTitleRow}>
                          <Text style={styles.stageTitle} numberOfLines={1}>
                            {row.title}
                          </Text>
                          <View style={[styles.typeBadge, { backgroundColor: badge.color }]}>
                            <Text style={styles.typeBadgeTxt}>
                              {badge.icon} {badge.label}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.stageSub} numberOfLines={2}>
                          {row.desc}
                        </Text>
                      </View>
                      {cleared ? (
                        <View style={styles.clearedPill}>
                          <Text style={styles.clearedTxt}>✓ CLEARED</Text>
                        </View>
                      ) : unlocked ? (
                        <Pressable
                          style={[
                            styles.takeBtn,
                            row.kind === 'battle' && styles.battleBtn,
                            (!meetsLevel || !meetsRank || busy) && styles.btnDisabled,
                          ]}
                          disabled={busy}
                          onPress={() => handleTakeStage(row)}
                        >
                          <Text style={styles.takeBtnTxt}>
                            {busy
                              ? 'Loading...'
                              : row.kind === 'battle'
                              ? '⚔️ Fight'
                              : '▶ Play Trial'}
                          </Text>
                        </Pressable>
                      ) : (
                        <View style={styles.lockedPill}>
                          <Text style={styles.lockedTxt}>🔒 LOCKED</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </>
        )}
      </View>

      {/* Authentic Ninja Saga Mini-Game Modal */}
      {activeMiniGame && (
        <ExamMiniGameModal
          visible={Boolean(activeMiniGame)}
          gameType={activeMiniGame.row.miniGame ?? 'quiz'}
          difficulty={activeMiniGame.exam.key as ExamDifficulty}
          title={`${activeMiniGame.exam.label} — ${activeMiniGame.row.title}`}
          subtitle={activeMiniGame.row.desc}
          onSuccess={handleCompleteMiniGame}
          onClose={() => setActiveMiniGame(null)}
        />
      )}

      {/* Special Jounin Class Choice Modal */}
      <Modal
        visible={showClassModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setShowClassModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.classModalCard}>
            <Text style={styles.modalTitle}>Choose Your Special Jounin Class</Text>
            <Text style={styles.modalSub}>
              Select 1 permanent Class Jutsu to receive with your Tensai Special Jounin Suit & Kinjutsu!
            </Text>
            <ScrollView
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingVertical: 6 }}
            >
              {SPECIAL_JOUNIN_CLASSES.map((cls) => {
                const picked = selectedClassId === cls.id;
                return (
                  <Pressable
                    key={cls.id}
                    style={[styles.classRow, picked && styles.classRowActive]}
                    onPress={() => setSelectedClassId(cls.id)}
                  >
                    <Text style={styles.classIcon}>{cls.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.className}>{cls.name}</Text>
                      <Text style={styles.classDesc}>{cls.desc}</Text>
                    </View>
                    <Text style={styles.classRadio}>{picked ? '◉' : '○'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: '#6B7280' }]}
                onPress={() => setShowClassModal(false)}
              >
                <Text style={styles.modalBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: '#D95B16' }]}
                disabled={promoting}
                onPress={() => executePromotion(selectedClassId)}
              >
                <Text style={styles.modalBtnTxt}>
                  {promoting ? 'Promoting...' : 'Confirm & Promote'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Promotion Celebration Modal */}
      <Modal
        visible={Boolean(promoCelebration)}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setPromoCelebration(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.promoCard}>
            <Text style={styles.promoIcon}>🏆🎖️</Text>
            <Text style={styles.promoTitle}>CONGRATULATIONS!</Text>
            <Text style={styles.promoRank}>
              Promoted to {promoCelebration?.rankLabel}!
            </Text>
            {promoCelebration && promoCelebration.rewards.length > 0 && (
              <View style={styles.promoRewardsBox}>
                <Text style={styles.promoRewardsHead}>Exam Rewards Received:</Text>
                {promoCelebration.rewards.map((code, i) => (
                  <Text key={i} style={styles.promoRewardLine}>
                    • {formatRewardCode(code)}
                  </Text>
                ))}
              </View>
            )}
            <Pressable
              style={[styles.modalBtn, { backgroundColor: '#16A34A', marginTop: 8 }]}
              onPress={() => setPromoCelebration(null)}
            >
              <Text style={styles.modalBtnTxt}>Awesome!</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 7 },
  rankBadge: {
    backgroundColor: '#3E2008',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  rankBadgeTxt: { color: '#FFE082', fontWeight: '800', fontSize: 12 },
  tabRow: { flexDirection: 'row', gap: 6 },
  tabBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: NS_THEME.tabActive,
    borderColor: '#FFE082',
  },
  tabTxt: { color: '#FFF4DC', fontWeight: '700', fontSize: 12 },
  tabTxtActive: { color: '#FFFFFF', fontWeight: '900' },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 10,
  },
  summaryLeft: { flex: 1, gap: 4 },
  summaryTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 13.5 },
  rewardChipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  rewardPrefix: { color: NS_THEME.inkSoft, fontWeight: '800', fontSize: 10.5 },
  rewardChip: {
    backgroundColor: '#3E2008',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: NS_THEME.goldTrim,
  },
  rewardChipTxt: { color: '#FFE082', fontWeight: '800', fontSize: 10 },
  promotedPill: {
    backgroundColor: '#2E8534',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  promotedTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 11 },
  promoteBtn: {
    backgroundColor: '#D95B16',
    borderWidth: 1.5,
    borderColor: '#FFE082',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  promoteBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 11.5 },
  reqPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  reqPillOk: { backgroundColor: '#2E8534' },
  reqPillLock: { backgroundColor: '#7A4C24' },
  reqPillTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 10.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stageList: { gap: 6, paddingBottom: 12 },
  stageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 8,
    gap: 10,
  },
  stageCardReady: {
    backgroundColor: NS_THEME.parchmentSelected,
    borderColor: '#D95B16',
  },
  stageCardCleared: {
    backgroundColor: '#E5F2D9',
    borderColor: '#2E8534',
  },
  stageNumBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: NS_THEME.woodBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageNumTxt: { color: '#FFE082', fontWeight: '900', fontSize: 13.5 },
  stageInfo: { flex: 1, gap: 2 },
  stageTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  stageTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 12.5 },
  typeBadge: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  typeBadgeTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 9.5 },
  stageSub: { color: NS_THEME.inkSoft, fontSize: 11 },
  takeBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#1E3A8A',
  },
  battleBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderColor: '#3E2008',
  },
  takeBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 11.5 },
  clearedPill: {
    backgroundColor: '#2E8534',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  clearedTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 11 },
  lockedPill: {
    backgroundColor: '#8D7A62',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  lockedTxt: { color: '#FFF4DC', fontWeight: '700', fontSize: 11 },
  btnDisabled: { opacity: 0.55 },
  emptyExamCard: {
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 6,
    maxWidth: 380,
  },
  emptyExamIcon: { fontSize: 38 },
  emptyExamTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 16 },
  emptyExamSub: { color: NS_THEME.inkSoft, fontWeight: '700', fontSize: 12.5, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 6, 2, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  classModalCard: {
    width: '86%',
    maxWidth: 560,
    maxHeight: '90%',
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 2.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  modalTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 16, textAlign: 'center' },
  modalSub: { color: NS_THEME.inkSoft, fontWeight: '700', fontSize: 11.5, textAlign: 'center' },
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFDF7',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    padding: 8,
  },
  classRowActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#D95B16',
  },
  classIcon: { fontSize: 22 },
  className: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 13 },
  classDesc: { color: NS_THEME.inkSoft, fontSize: 11 },
  classRadio: { color: '#D95B16', fontWeight: '900', fontSize: 18 },
  modalBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  modalBtn: {
    borderRadius: 9,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: '#FFE082',
  },
  modalBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 12.5 },
  promoCard: {
    width: '78%',
    maxWidth: 440,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 2.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  promoIcon: { fontSize: 38 },
  promoTitle: { color: '#B45309', fontWeight: '900', fontSize: 18 },
  promoRank: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 14.5 },
  promoRewardsBox: {
    width: '100%',
    backgroundColor: '#FFF8EB',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 10,
    gap: 4,
    marginTop: 4,
  },
  promoRewardsHead: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 12 },
  promoRewardLine: { color: '#15803D', fontWeight: '800', fontSize: 12 },
});
