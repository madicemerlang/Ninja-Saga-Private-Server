import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NS_THEME } from './NinjaScrollWindow';

export type ExamMiniGameType = 'quiz' | 'handseal' | 'chakra' | 'scrollpair';
export type ExamDifficulty = 'chunin' | 'jounin' | 'specialJounin' | 'ninjaTutor';

export interface ExamMiniGameModalProps {
  visible: boolean;
  gameType: ExamMiniGameType;
  difficulty: ExamDifficulty;
  title: string;
  subtitle: string;
  onSuccess: () => void;
  onClose: () => void;
}

interface QuizQuestion {
  q: string;
  options: string[];
  answer: number;
}

const QUIZ_POOLS: Record<ExamDifficulty, QuizQuestion[]> = {
  chunin: [
    {
      q: 'Which element has an advantage over Wind in the Five Elements cycle?',
      options: ['Water', 'Fire', 'Earth', 'Lightning'],
      answer: 1,
    },
    {
      q: 'What is the maximum level a Genin can reach before passing the Chunin Exam?',
      options: ['Level 15', 'Level 20', 'Level 25', 'Level 30'],
      answer: 1,
    },
    {
      q: 'Which building in the village is used to learn new elemental Ninjutsu?',
      options: ['Blacksmith', 'Academy', 'Hunting House', 'Pet Shop'],
      answer: 1,
    },
    {
      q: 'What does the "Charge" action restore during a shinobi battle?',
      options: ['Health Points (HP)', 'Chakra Points (CP)', 'Gold', 'Cooldowns'],
      answer: 1,
    },
    {
      q: 'Which Kinjutsu is awarded upon passing the Chunin Exam?',
      options: [
        'Kinjutsu: Spirit Touch',
        'Kinjutsu: Serene Mind',
        'Kinjutsu: Flying Thunder God',
        'Kinjutsu: Five Elements Seal',
      ],
      answer: 0,
    },
    {
      q: 'In the Ninja Saga battle timeline, which attribute determines turn speed?',
      options: ['Dodge', 'Accuracy', 'Agility', 'Purify'],
      answer: 2,
    },
    {
      q: 'Which status effect prevents a shinobi from acting on their turn?',
      options: ['Burn', 'Stun', 'Poison', 'Slow'],
      answer: 1,
    },
  ],
  jounin: [
    {
      q: 'Which element counters Lightning in the Five Elements wheel?',
      options: ['Wind', 'Water', 'Fire', 'Earth'],
      answer: 0,
    },
    {
      q: 'What does the "Restrict" debuff prevent a shinobi from doing?',
      options: ['Basic Attack', 'Using Jutsu Skills', 'Dodging', 'Receiving Heals'],
      answer: 1,
    },
    {
      q: 'Which Kinjutsu is awarded upon graduating from the Jounin Exam?',
      options: [
        'Kinjutsu: Spirit Touch',
        'Kinjutsu: Serene Mind',
        'Kinjutsu: Water Renewal',
        'Kinjutsu: Five Elements Consuming Seal',
      ],
      answer: 1,
    },
    {
      q: 'Which attribute gives a chance to cleanse negative debuffs automatically?',
      options: ['Reactive Force', 'Combustion', 'Purify', 'Critical'],
      answer: 2,
    },
    {
      q: 'How many recruited Allies (NPCs or Friends) can join your battle team at once?',
      options: ['1 Ally', '2 Allies', '3 Allies', '4 Allies'],
      answer: 1,
    },
    {
      q: 'What materials are granted alongside Kinjutsu: Serene Mind on Jounin promotion?',
      options: ['5 Elemental Scrolls', '5x of all 5 Magatamas', '10 Smoke Bombs', '3 Pet Foods'],
      answer: 1,
    },
  ],
  specialJounin: [
    {
      q: 'How many Special Jounin Classes can a Jounin choose from upon promotion?',
      options: ['3 Classes', '4 Classes', '5 Classes', '6 Classes'],
      answer: 2,
    },
    {
      q: 'Which Special Jounin Class Jutsu removes all negative statuses even while stunned?',
      options: ['Medical Class', 'Sensation Class', 'Intelligence Class', 'Offense Class'],
      answer: 1,
    },
    {
      q: 'What does Offense Class Jutsu collect each turn to unleash +150% burst damage?',
      options: ['7 Chakra Balls', '5 Wind Blades', '3 Shadow Clones', '4 Magatamas'],
      answer: 0,
    },
    {
      q: 'What is the level requirement to attempt the Special Jounin Exam?',
      options: ['Level 40', 'Level 50', 'Level 60', 'Level 70'],
      answer: 2,
    },
    {
      q: 'Which Kinjutsu removes 25% of the target\'s current HP upon Special Jounin promotion?',
      options: [
        'Kinjutsu: Spirit Touch',
        'Kinjutsu: Five Elements Consuming Seal',
        'Kinjutsu: Serene Mind',
        'Kinjutsu: Thunder God Wrath',
      ],
      answer: 1,
    },
    {
      q: 'Which Special Jounin Class allows scouting enemy HP/CP and 4 random Jutsu?',
      options: ['Assault Class', 'Medical Class', 'Intelligence Class', 'Sensation Class'],
      answer: 2,
    },
  ],
  ninjaTutor: [
    {
      q: 'What rank title is bestowed upon clearing all 12 chapters of the Ninja Tutor Exam?',
      options: ['Kage', 'Senior Ninja Tutor', 'ANBU Captain', 'Grand Sage'],
      answer: 1,
    },
    {
      q: 'Which legendary Lv. 80 weapon is awarded for completing the Ninja Tutor Exam?',
      options: ['Chunin Nunchaku', 'Bloodstain Blade', 'Dragon Katana', 'Shadow Kunai'],
      answer: 1,
    },
    {
      q: 'Which back item is awarded alongside the Senior Ninja Tutor Suit?',
      options: ['Light of Eternal', 'Scroll of Heaven', 'Sage Cloak', 'Twin Fan'],
      answer: 0,
    },
    {
      q: 'Which element suppresses Earth in the Five Elements cycle?',
      options: ['Fire', 'Water', 'Lightning', 'Wind'],
      answer: 2,
    },
    {
      q: 'What is the required level to challenge the Ninja Tutor Exam?',
      options: ['Level 60', 'Level 70', 'Level 80', 'Level 90'],
      answer: 2,
    },
    {
      q: 'Which Special Jounin Class Jutsu ignores target status to execute low-HP foes?',
      options: ['Assault Class', 'Medical Class', 'Intelligence Class', 'Sensation Class'],
      answer: 0,
    },
  ],
};

const SEALS = [
  { id: 0, label: 'Tiger', kanji: '寅', emoji: '🐯', color: '#DC2626' },
  { id: 1, label: 'Boar', kanji: '亥', emoji: '🐗', color: '#D97706' },
  { id: 2, label: 'Snake', kanji: '巳', emoji: '🐍', color: '#16A34A' },
  { id: 3, label: 'Bird', kanji: '酉', emoji: '🦅', color: '#0284C7' },
  { id: 4, label: 'Dragon', kanji: '辰', emoji: '🐉', color: '#7C3AED' },
  { id: 5, label: 'Monkey', kanji: '申', emoji: '🐒', color: '#DB2777' },
];

const SCROLL_SYMBOLS = [
  { key: 'heaven', emoji: '📜', label: 'Heaven' },
  { key: 'earth', emoji: '🪨', label: 'Earth' },
  { key: 'fire', emoji: '🔥', label: 'Fire' },
  { key: 'wind', emoji: '🌪️', label: 'Wind' },
  { key: 'bolt', emoji: '⚡', label: 'Bolt' },
  { key: 'kunai', emoji: '🗡️', label: 'Kunai' },
];

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ── 1. WRITTEN EXAM QUIZ MINI-GAME ── */
function WrittenQuizGame({
  difficulty,
  onSuccess,
  onRetryReset,
}: {
  difficulty: ExamDifficulty;
  onSuccess: () => void;
  onRetryReset: number;
}) {
  const questions = useMemo(() => shuffle(QUIZ_POOLS[difficulty]).slice(0, 5), [difficulty, onRetryReset]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    setIdx(0);
    setScore(0);
    setPicked(null);
    setTimeLeft(15);
    setFinished(false);
  }, [questions]);

  useEffect(() => {
    if (finished || picked !== null) return;
    if (timeLeft <= 0) {
      setPicked(-1);
      const t = setTimeout(() => {
        if (idx + 1 >= questions.length) {
          setFinished(true);
        } else {
          setIdx((i) => i + 1);
          setPicked(null);
          setTimeLeft(15);
        }
      }, 700);
      return () => clearTimeout(t);
    }
    const timer = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, finished, picked, idx, questions.length]);

  const current = questions[idx];
  const passed = score >= 4;

  const handleAnswer = (optIdx: number) => {
    if (picked !== null || finished) return;
    setPicked(optIdx);
    const isCorrect = optIdx === current.answer;
    const nextScore = isCorrect ? score + 1 : score;
    if (isCorrect) setScore(nextScore);

    setTimeout(() => {
      if (idx + 1 >= questions.length) {
        setFinished(true);
      } else {
        setIdx((i) => i + 1);
        setPicked(null);
        setTimeLeft(15);
      }
    }, 650);
  };

  if (finished) {
    return (
      <View style={styles.resultBox}>
        <Text style={styles.resultEmoji}>{passed ? '📜✨' : '❌'}</Text>
        <Text style={[styles.resultTitle, !passed && { color: '#DC2626' }]}>
          {passed ? 'WRITTEN EXAM PASSED!' : 'WRITTEN EXAM FAILED'}
        </Text>
        <Text style={styles.resultDesc}>
          Score: {score} / {questions.length} (Need 4 / 5 to pass)
        </Text>
        {passed ? (
          <Pressable style={styles.primaryBtn} onPress={onSuccess}>
            <Text style={styles.primaryBtnTxt}>Complete Stage ✓</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: '#B45309' }]}
            onPress={() => {
              setIdx(0);
              setScore(0);
              setPicked(null);
              setTimeLeft(15);
              setFinished(false);
            }}
          >
            <Text style={styles.primaryBtnTxt}>Retry Written Exam</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.gameBody}>
      <View style={styles.metaRow}>
        <Text style={styles.metaPill}>
          Question {idx + 1} / {questions.length}
        </Text>
        <Text style={styles.metaPill}>Score: {score}</Text>
        <Text style={[styles.metaPill, timeLeft <= 5 && { backgroundColor: '#B91C1C' }]}>
          ⏱ {timeLeft}s
        </Text>
      </View>
      <View style={styles.questionCard}>
        <Text style={styles.questionTxt}>{current.q}</Text>
      </View>
      <View style={styles.optionsGrid}>
        {current.options.map((opt, i) => {
          const isPicked = picked === i;
          const isRight = picked !== null && i === current.answer;
          const isWrong = isPicked && i !== current.answer;
          return (
            <Pressable
              key={i}
              style={[
                styles.optionBtn,
                isRight && styles.optionCorrect,
                isWrong && styles.optionWrong,
              ]}
              onPress={() => handleAnswer(i)}
            >
              <Text style={styles.optionLetter}>{String.fromCharCode(65 + i)}.</Text>
              <Text style={styles.optionTxt} numberOfLines={2}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ── 2. HAND-SEAL MEMORY MINI-GAME ── */
function HandSealMemoryGame({
  difficulty,
  onSuccess,
}: {
  difficulty: ExamDifficulty;
  onSuccess: () => void;
}) {
  const roundLengths = useMemo(
    () =>
      difficulty === 'chunin'
        ? [3, 4, 5]
        : difficulty === 'jounin'
        ? [4, 5, 5]
        : [4, 5, 6],
    [difficulty]
  );

  const [round, setRound] = useState(0);
  const [sequence, setSequence] = useState<number[]>([]);
  const [phase, setPhase] = useState<'showing' | 'input' | 'failed' | 'passed'>('showing');
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [inputIdx, setInputIdx] = useState(0);
  const [statusTxt, setStatusTxt] = useState('Watch the Proctor weave the Hand Seals...');

  const startRound = (r: number) => {
    const len = roundLengths[r] ?? 4;
    const seq = Array.from({ length: len }, () => Math.floor(Math.random() * SEALS.length));
    setSequence(seq);
    setInputIdx(0);
    setPhase('showing');
    setStatusTxt(`Round ${r + 1}/${roundLengths.length}: Memorize ${len} Hand Seals!`);
  };

  useEffect(() => {
    startRound(0);
  }, [roundLengths]);

  useEffect(() => {
    if (phase !== 'showing' || sequence.length === 0) return;
    let cancelled = false;
    const stepMs = difficulty === 'chunin' ? 620 : 500;
    const timers: ReturnType<typeof setTimeout>[] = [];

    sequence.forEach((sealId, idx) => {
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setHighlightId(sealId);
        }, 400 + idx * (stepMs + 180))
      );
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setHighlightId(null);
        }, 400 + idx * (stepMs + 180) + stepMs)
      );
    });

    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        setPhase('input');
        setStatusTxt(`Your turn! Tap the ${sequence.length} seals in exact order.`);
      }, 450 + sequence.length * (stepMs + 180))
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [phase, sequence, difficulty]);

  const handleTapSeal = (sealId: number) => {
    if (phase !== 'input') return;
    setHighlightId(sealId);
    setTimeout(() => setHighlightId(null), 180);

    if (sequence[inputIdx] !== sealId) {
      setPhase('failed');
      setStatusTxt('Wrong hand seal! The jutsu misfired.');
      return;
    }

    const nextIdx = inputIdx + 1;
    setInputIdx(nextIdx);
    if (nextIdx >= sequence.length) {
      if (round + 1 >= roundLengths.length) {
        setPhase('passed');
        setStatusTxt('Perfect Hand-Seal Mastery!');
      } else {
        const nextRound = round + 1;
        setRound(nextRound);
        setStatusTxt('Seal combo matched! Next round...');
        setTimeout(() => startRound(nextRound), 650);
      }
    }
  };

  if (phase === 'passed') {
    return (
      <View style={styles.resultBox}>
        <Text style={styles.resultEmoji}>🙌🔥</Text>
        <Text style={styles.resultTitle}>HAND-SEAL TRIAL CLEARED!</Text>
        <Text style={styles.resultDesc}>You mastered all {roundLengths.length} Zodiac Seal sequences.</Text>
        <Pressable style={styles.primaryBtn} onPress={onSuccess}>
          <Text style={styles.primaryBtnTxt}>Complete Stage ✓</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.gameBody}>
      <View style={styles.metaRow}>
        <Text style={styles.metaPill}>
          Round {round + 1} / {roundLengths.length}
        </Text>
        <Text style={styles.metaPill}>
          Progress: {inputIdx} / {sequence.length}
        </Text>
      </View>
      <Text style={styles.sealStatusTxt}>{statusTxt}</Text>
      <View style={styles.sealGrid}>
        {SEALS.map((s) => {
          const lit = highlightId === s.id;
          return (
            <Pressable
              key={s.id}
              disabled={phase !== 'input'}
              style={[
                styles.sealTile,
                { borderColor: s.color },
                lit && { backgroundColor: s.color, transform: [{ scale: 1.06 }] },
              ]}
              onPress={() => handleTapSeal(s.id)}
            >
              <Text style={styles.sealEmoji}>{s.emoji}</Text>
              <Text style={[styles.sealKanji, lit && { color: '#FFFFFF' }]}>{s.kanji}</Text>
              <Text style={[styles.sealLabel, lit && { color: '#FFFFFF' }]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {phase === 'failed' && (
        <Pressable
          style={[styles.primaryBtn, { alignSelf: 'center', marginTop: 6, backgroundColor: '#B45309' }]}
          onPress={() => {
            setRound(0);
            startRound(0);
          }}
        >
          <Text style={styles.primaryBtnTxt}>Retry Hand-Seal Trial</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ── 3. CHAKRA CONTROL TIMING MINI-GAME ── */
function ChakraTimingGame({
  difficulty,
  onSuccess,
}: {
  difficulty: ExamDifficulty;
  onSuccess: () => void;
}) {
  const targetHits = 4;
  const maxMisses = 3;
  const zoneWidthPct = difficulty === 'chunin' ? 24 : difficulty === 'jounin' ? 20 : 17;
  const speedMs = difficulty === 'chunin' ? 1150 : difficulty === 'jounin' ? 920 : 780;

  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [zoneStart, setZoneStart] = useState(38);
  const [feedback, setFeedback] = useState('Tap RELEASE when the marker hits the golden seal!');
  const posRef = useRef(0);
  const anim = useRef(new Animated.Value(0)).current;

  const passed = hits >= targetHits;
  const failed = misses >= maxMisses;

  useEffect(() => {
    const id = anim.addListener(({ value }) => {
      posRef.current = value;
    });
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    if (passed || failed) return;
    anim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 100, duration: speedMs, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: speedMs, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, speedMs, passed, failed]);

  const handleRelease = () => {
    if (passed || failed) return;
    const cur = posRef.current;
    const inZone = cur >= zoneStart && cur <= zoneStart + zoneWidthPct;
    if (inZone) {
      setHits((h) => h + 1);
      setFeedback('✨ PERFECT CHAKRA FOCUS!');
      setZoneStart(12 + Math.floor(Math.random() * (76 - zoneWidthPct)));
    } else {
      setMisses((m) => m + 1);
      setFeedback('💥 Chakra slipped! Watch the golden zone.');
    }
  };

  if (passed || failed) {
    return (
      <View style={styles.resultBox}>
        <Text style={styles.resultEmoji}>{passed ? '⚡✨' : '💥'}</Text>
        <Text style={[styles.resultTitle, failed && { color: '#DC2626' }]}>
          {passed ? 'CHAKRA CONTROL MASTERED!' : 'CHAKRA FOCUS FAILED'}
        </Text>
        <Text style={styles.resultDesc}>
          Hits: {hits}/{targetHits} • Misses: {misses}/{maxMisses}
        </Text>
        {passed ? (
          <Pressable style={styles.primaryBtn} onPress={onSuccess}>
            <Text style={styles.primaryBtnTxt}>Complete Stage ✓</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: '#B45309' }]}
            onPress={() => {
              setHits(0);
              setMisses(0);
              setFeedback('Tap RELEASE when the marker hits the golden seal!');
            }}
          >
            <Text style={styles.primaryBtnTxt}>Retry Chakra Trial</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const needleLeft = anim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '96%'],
  });

  return (
    <View style={styles.gameBody}>
      <View style={styles.metaRow}>
        <Text style={[styles.metaPill, { backgroundColor: '#15803D' }]}>
          ✓ Seals: {hits} / {targetHits}
        </Text>
        <Text style={[styles.metaPill, { backgroundColor: '#B91C1C' }]}>
          ✕ Misses: {misses} / {maxMisses}
        </Text>
      </View>
      <Text style={styles.sealStatusTxt}>{feedback}</Text>
      <View style={styles.chakraTrackWrap}>
        <View style={styles.chakraTrack}>
          <View
            style={[
              styles.chakraZone,
              { left: `${zoneStart}%`, width: `${zoneWidthPct}%` },
            ]}
          />
          <Animated.View style={[styles.chakraNeedle, { left: needleLeft }]} />
        </View>
      </View>
      <Pressable style={styles.releaseBtn} onPress={handleRelease}>
        <Text style={styles.releaseBtnTxt}>⚡ RELEASE CHAKRA!</Text>
      </Pressable>
    </View>
  );
}

/* ── 4. SCROLL / SHADOW CLONE PAIR MATCH MINI-GAME ── */
function ScrollPairGame({ onSuccess }: { onSuccess: () => void }) {
  const [cards, setCards] = useState(() =>
    shuffle([...SCROLL_SYMBOLS, ...SCROLL_SYMBOLS]).map((s, idx) => ({
      uid: idx,
      ...s,
      matched: false,
    }))
  );
  const [openIds, setOpenIds] = useState<number[]>([]);
  const [timeLeft, setTimeLeft] = useState(45);
  const [lock, setLock] = useState(false);

  const allMatched = cards.every((c) => c.matched);
  const failed = !allMatched && timeLeft <= 0;

  useEffect(() => {
    if (allMatched || failed) return;
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, allMatched, failed]);

  const handleFlip = (uid: number) => {
    if (lock || allMatched || failed) return;
    if (openIds.includes(uid)) return;
    const card = cards.find((c) => c.uid === uid);
    if (!card || card.matched) return;

    const nextOpen = [...openIds, uid];
    setOpenIds(nextOpen);

    if (nextOpen.length === 2) {
      setLock(true);
      const [aId, bId] = nextOpen;
      const a = cards.find((c) => c.uid === aId);
      const b = cards.find((c) => c.uid === bId);
      if (a && b && a.key === b.key) {
        setTimeout(() => {
          setCards((prev) =>
            prev.map((c) => (c.uid === aId || c.uid === bId ? { ...c, matched: true } : c))
          );
          setOpenIds([]);
          setLock(false);
        }, 280);
      } else {
        setTimeout(() => {
          setOpenIds([]);
          setLock(false);
        }, 550);
      }
    }
  };

  if (allMatched || failed) {
    return (
      <View style={styles.resultBox}>
        <Text style={styles.resultEmoji}>{allMatched ? '📜✨' : '⌛'}</Text>
        <Text style={[styles.resultTitle, failed && { color: '#DC2626' }]}>
          {allMatched ? 'SCROLL MATCH CLEARED!' : 'TIME EXPIRED'}
        </Text>
        <Text style={styles.resultDesc}>
          {allMatched ? `All 6 ninja scroll pairs matched with ${timeLeft}s remaining!` : 'Try again faster!'}
        </Text>
        {allMatched ? (
          <Pressable style={styles.primaryBtn} onPress={onSuccess}>
            <Text style={styles.primaryBtnTxt}>Complete Stage ✓</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: '#B45309' }]}
            onPress={() => {
              setCards(
                shuffle([...SCROLL_SYMBOLS, ...SCROLL_SYMBOLS]).map((s, idx) => ({
                  uid: idx,
                  ...s,
                  matched: false,
                }))
              );
              setOpenIds([]);
              setTimeLeft(45);
              setLock(false);
            }}
          >
            <Text style={styles.primaryBtnTxt}>Retry Scroll Trial</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.gameBody}>
      <View style={styles.metaRow}>
        <Text style={styles.metaPill}>
          Matched: {cards.filter((c) => c.matched).length / 2} / 6
        </Text>
        <Text style={[styles.metaPill, timeLeft <= 10 && { backgroundColor: '#B91C1C' }]}>
          ⏱ {timeLeft}s
        </Text>
      </View>
      <View style={styles.pairGrid}>
        {cards.map((c) => {
          const revealed = c.matched || openIds.includes(c.uid);
          return (
            <Pressable
              key={c.uid}
              style={[
                styles.pairCard,
                revealed && styles.pairCardOpen,
                c.matched && styles.pairCardMatched,
              ]}
              onPress={() => handleFlip(c.uid)}
            >
              <Text style={styles.pairEmoji}>{revealed ? c.emoji : '⛩️'}</Text>
              <Text style={styles.pairLabel}>{revealed ? c.label : 'Seal'}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ExamMiniGameModal({
  visible,
  gameType,
  difficulty,
  title,
  subtitle,
  onSuccess,
  onClose,
}: ExamMiniGameModalProps) {
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (visible) setRetryKey((k) => k + 1);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>{title}</Text>
              <Text style={styles.headerSub}>{subtitle}</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnTxt}>✕</Text>
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {gameType === 'quiz' && (
              <WrittenQuizGame
                difficulty={difficulty}
                onSuccess={onSuccess}
                onRetryReset={retryKey}
              />
            )}
            {gameType === 'handseal' && (
              <HandSealMemoryGame difficulty={difficulty} onSuccess={onSuccess} />
            )}
            {gameType === 'chakra' && (
              <ChakraTimingGame difficulty={difficulty} onSuccess={onSuccess} />
            )}
            {gameType === 'scrollpair' && <ScrollPairGame onSuccess={onSuccess} />}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 6, 2, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '88%',
    maxWidth: 640,
    maxHeight: '92%',
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 2.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 14,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3E2008',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 2,
    borderBottomColor: NS_THEME.goldTrim,
    gap: 10,
  },
  headerTitle: { color: '#FFE082', fontWeight: '900', fontSize: 15 },
  headerSub: { color: '#FDE68A', fontSize: 11, fontWeight: '600' },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#7F1D1D',
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  scrollContent: { padding: 12 },
  gameBody: { gap: 10 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  metaPill: {
    backgroundColor: '#3E2008',
    color: '#FFE082',
    fontWeight: '800',
    fontSize: 11.5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  questionCard: {
    backgroundColor: '#FFF8EB',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 10,
    padding: 12,
  },
  questionTxt: {
    color: NS_THEME.inkDark,
    fontWeight: '800',
    fontSize: 13.5,
    textAlign: 'center',
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  optionBtn: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFDF7',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  optionCorrect: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
  },
  optionWrong: {
    backgroundColor: '#FEE2E2',
    borderColor: '#DC2626',
  },
  optionLetter: { color: '#9A3412', fontWeight: '900', fontSize: 13 },
  optionTxt: { flex: 1, color: NS_THEME.inkDark, fontWeight: '700', fontSize: 12 },
  sealStatusTxt: {
    color: NS_THEME.inkDark,
    fontWeight: '800',
    fontSize: 13,
    textAlign: 'center',
  },
  sealGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  sealTile: {
    width: '30%',
    minWidth: 92,
    backgroundColor: '#FFF8EB',
    borderWidth: 2,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 1,
  },
  sealEmoji: { fontSize: 22 },
  sealKanji: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 14 },
  sealLabel: { color: NS_THEME.inkSoft, fontWeight: '800', fontSize: 10.5 },
  chakraTrackWrap: {
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  chakraTrack: {
    height: 30,
    backgroundColor: '#1E293B',
    borderRadius: 15,
    borderWidth: 2,
    borderColor: NS_THEME.goldTrim,
    position: 'relative',
    overflow: 'hidden',
  },
  chakraZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(250, 204, 21, 0.55)',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: '#FDE047',
  },
  chakraNeedle: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 10,
    backgroundColor: '#38BDF8',
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  releaseBtn: {
    alignSelf: 'center',
    backgroundColor: '#D95B16',
    borderWidth: 2,
    borderColor: '#FFE082',
    borderRadius: 10,
    paddingHorizontal: 26,
    paddingVertical: 10,
  },
  releaseBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  pairGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
  },
  pairCard: {
    width: '15%',
    minWidth: 74,
    backgroundColor: '#5C3012',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  pairCardOpen: {
    backgroundColor: '#FFF8EB',
  },
  pairCardMatched: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
  },
  pairEmoji: { fontSize: 20 },
  pairLabel: { color: '#FFE082', fontWeight: '800', fontSize: 10, marginTop: 2 },
  resultBox: {
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  resultEmoji: { fontSize: 36 },
  resultTitle: { color: '#15803D', fontWeight: '900', fontSize: 17 },
  resultDesc: { color: NS_THEME.inkDark, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: '#16A34A',
    borderWidth: 1.5,
    borderColor: '#FFE082',
    borderRadius: 10,
    paddingHorizontal: 22,
    paddingVertical: 9,
    marginTop: 4,
  },
  primaryBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
});
