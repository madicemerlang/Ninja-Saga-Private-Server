import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  loadGameData,
  loadLibraryData,
  loadPetsJson,
  type RawSkillEffectDef,
} from '../api/gameData';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { JutsuPreviewModal } from '../components/JutsuPreviewModal';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { buildIconSheetSwfUrl, buildSwfAssetUrl, normalizeBaseUrl } from '../config/env';
import { RuffleStageView, type RuffleStageHandle, type StageEvent } from '../stage/RuffleStageView';
import { useAuthStore } from '../store/useAuthStore';

type MainTab = 'weapon' | 'back' | 'element' | 'taijutsu' | 'genjutsu' | 'talent' | 'pets';
type ElementFilter = '1' | '2' | '3' | '4' | '5';

interface AssetEncyclopediaEntry {
  id: string;
  name: string;
  tab: MainTab;
  iconCategory: 'items' | 'skills' | 'pets';
  level: number;
  damage: number;
  cpCost?: number;
  cooldown?: number;
  priceGold: number;
  priceTokens: number;
  elementType?: string;
  isPassiveTalent?: boolean;
  badgeLabel: string;
  badgeColor: string;
  description: string;
  effects: string[];
  petStats?: { agility: number; dodge: number; critical: number; emblem?: boolean };
  petSkills?: Array<{ level: number; name: string; description: string; cooldown: number; dmg?: number }>;
}

const PAGE_SIZE = 36;

const ELEMENT_META: Record<string, { label: string; icon: string; color: string }> = {
  '1': { label: 'Wind', icon: '💨', color: '#059669' },
  '2': { label: 'Fire', icon: '🔥', color: '#DC2626' },
  '3': { label: 'Lightning', icon: '⚡', color: '#CA8A04' },
  '4': { label: 'Earth', icon: '🪨', color: '#B45309' },
  '5': { label: 'Water', icon: '💧', color: '#0284C7' },
};

function formatRawEffect(e: RawSkillEffectDef): string {
  const name = e.effect_name || e.effect.replace(/_/g, ' ');
  const parts: string[] = [name];
  if (e.amount && e.amount > 0) {
    parts.push(`${e.amount}${e.calc_type === 'percent' ? '%' : ''}`);
  }
  const dur = e.duration ?? e.amount_duration ?? 0;
  if (dur > 0) parts.push(`(${dur}t)`);
  if (e.chance && e.chance > 0 && e.chance < 100) parts.push(`[${e.chance}%]`);
  return parts.join(' ');
}

export function EncyclopediaScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const navigate = useAuthStore((s) => s.navigate);

  const iconBridgeRef = useRef<RuffleStageHandle>(null);
  const requestedIconsRef = useRef<Set<string>>(new Set());

  const [bridgeReady, setBridgeReady] = useState(false);
  const [iconUris, setIconUris] = useState<Record<string, string>>({});

  const [tab, setTab] = useState<MainTab>('weapon');
  const [elemFilter, setElemFilter] = useState<ElementFilter>('1');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{
    id: string;
    name: string;
    kind: 'skills' | 'pets';
  } | null>(null);

  const [assetsLoading, setAssetsLoading] = useState(true);
  const [allAssets, setAllAssets] = useState<AssetEncyclopediaEntry[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setAssetsLoading(true);
      try {
        const clean = normalizeBaseUrl(serverUrl);
        const [libBundle, gameBundle, petsMap, wpnEffRaw, backEffRaw, talentsRaw] = await Promise.all([
          loadLibraryData(serverUrl).catch(() => ({ items: [], itemsById: {} })),
          loadGameData(serverUrl).catch(() => ({
            missions: [],
            skills: [],
            skillsById: {},
            skillEffectsById: {} as Record<string, RawSkillEffectDef[]>,
            enemies: [],
            enemiesById: {},
          })),
          loadPetsJson(serverUrl).catch(() => ({})),
          fetch(`${clean}/game_data/weapon-effect.json`)
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => []),
          fetch(`${clean}/game_data/back_item-effect.json`)
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => []),
          fetch(`${clean}/game_data/talents.json`)
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => []),
        ]);

        const itemEffMap: Record<string, string[]> = {};
        for (const list of [wpnEffRaw, backEffRaw]) {
          if (!Array.isArray(list)) continue;
          for (const row of list as Array<{ id?: string; effects?: RawSkillEffectDef[] }>) {
            if (row?.id && Array.isArray(row.effects)) {
              itemEffMap[row.id] = row.effects.map(formatRawEffect);
            }
          }
        }

        const built: AssetEncyclopediaEntry[] = [];

        // Weapons & Back Items
        for (const item of libBundle.items) {
          if (!item?.id || item.id.toLowerCase().includes('kontol')) continue;
          if (item.type === 'wpn') {
            built.push({
              id: item.id,
              name: item.name || item.id,
              tab: 'weapon',
              iconCategory: 'items',
              level: Number(item.level ?? 1),
              damage: Number(item.damage ?? 0),
              priceGold: Number(item.price_gold ?? 0),
              priceTokens: Number(item.price_tokens ?? 0),
              badgeLabel: `Weapon • Lv.${item.level ?? 1}`,
              badgeColor: '#B45309',
              description: item.description || 'Authentic shinobi weapon.',
              effects: itemEffMap[item.id] ?? [],
            });
          } else if (item.type === 'back') {
            built.push({
              id: item.id,
              name: item.name || item.id,
              tab: 'back',
              iconCategory: 'items',
              level: Number(item.level ?? 1),
              damage: Number(item.damage ?? 0),
              priceGold: Number(item.price_gold ?? 0),
              priceTokens: Number(item.price_tokens ?? 0),
              badgeLabel: `Back Item • Lv.${item.level ?? 1}`,
              badgeColor: '#6D28D9',
              description: item.description || 'Authentic shinobi back item.',
              effects: itemEffMap[item.id] ?? [],
            });
          }
        }

        // Jutsu (5 Elements), Taijutsu (type 6), Genjutsu (type 7)
        for (const sk of gameBundle.skills) {
          if (!sk?.id) continue;
          const t = String(sk.type ?? '');
          const effs = (gameBundle.skillEffectsById[sk.id] ?? []).map(formatRawEffect);
          if (ELEMENT_META[t]) {
            const em = ELEMENT_META[t];
            built.push({
              id: sk.id,
              name: sk.name || sk.id,
              tab: 'element',
              iconCategory: 'skills',
              level: Number(sk.level ?? 1),
              damage: Number(sk.damage ?? 0),
              cpCost: Number(sk.cp_cost ?? 0),
              cooldown: Number(sk.cooldown ?? 0),
              priceGold: Number(sk.price_gold ?? 0),
              priceTokens: Number(sk.price_tokens ?? 0),
              elementType: t,
              badgeLabel: `${em.icon} ${em.label} Jutsu • Lv.${sk.level ?? 1}`,
              badgeColor: em.color,
              description: sk.description || 'Elemental Ninjutsu.',
              effects: effs,
            });
          } else if (t === '6') {
            built.push({
              id: sk.id,
              name: sk.name || sk.id,
              tab: 'taijutsu',
              iconCategory: 'skills',
              level: Number(sk.level ?? 1),
              damage: Number(sk.damage ?? 0),
              cpCost: Number(sk.cp_cost ?? 0),
              cooldown: Number(sk.cooldown ?? 0),
              priceGold: Number(sk.price_gold ?? 0),
              priceTokens: Number(sk.price_tokens ?? 0),
              badgeLabel: `🥋 Taijutsu • Lv.${sk.level ?? 1}`,
              badgeColor: '#C2410C',
              description: sk.description || 'Martial Taijutsu art.',
              effects: effs,
            });
          } else if (t === '7') {
            built.push({
              id: sk.id,
              name: sk.name || sk.id,
              tab: 'genjutsu',
              iconCategory: 'skills',
              level: Number(sk.level ?? 1),
              damage: Number(sk.damage ?? 0),
              cpCost: Number(sk.cp_cost ?? 0),
              cooldown: Number(sk.cooldown ?? 0),
              priceGold: Number(sk.price_gold ?? 0),
              priceTokens: Number(sk.price_tokens ?? 0),
              badgeLabel: `👁️ Genjutsu • Lv.${sk.level ?? 1}`,
              badgeColor: '#7C3AED',
              description: sk.description || 'Illusion Genjutsu art.',
              effects: effs,
            });
          }
        }

        // All Talent Skills from talents.json (grouped by base skill ID, keeping highest level entry)
        if (Array.isArray(talentsRaw)) {
          const talentByBase = new Map<
            string,
            {
              baseId: string;
              lv: number;
              name: string;
              desc: string;
              dmg: number;
              cp: number;
              cd: number;
              type: string;
              effects: RawSkillEffectDef[];
            }
          >();
          for (const raw of talentsRaw as Array<Record<string, unknown>>) {
            const fullId = String(raw?.id ?? '');
            if (!fullId) continue;
            const [baseId, lvStr] = fullId.split(':');
            const lv = Number(lvStr ?? 1);
            const prev = talentByBase.get(baseId);
            if (!prev || lv > prev.lv) {
              talentByBase.set(baseId, {
                baseId,
                lv,
                name: String(raw.talent_skill_name ?? baseId),
                desc: String(raw.talent_skill_description ?? ''),
                dmg: Number(raw.talent_skill_damage ?? 0),
                cp: Number(raw.talent_skill_cp_cost ?? 0),
                cd: Number(raw.skill_cooldown ?? 0),
                type: String(raw.type ?? 'secret'),
                effects: Array.isArray(raw.effects) ? (raw.effects as RawSkillEffectDef[]) : [],
              });
            }
          }
          for (const t of talentByBase.values()) {
            const isPassive = t.dmg <= 0 && t.cp <= 0 && t.cd <= 0;
            const tierLabel = t.type === 'extreme' ? 'Extreme' : 'Secret';
            built.push({
              id: t.baseId,
              name: t.name,
              tab: 'talent',
              iconCategory: 'skills',
              level: t.lv,
              damage: t.dmg,
              cpCost: isPassive ? undefined : t.cp,
              cooldown: isPassive ? undefined : t.cd,
              priceGold: 0,
              priceTokens: 0,
              isPassiveTalent: isPassive,
              badgeLabel: `✨ ${tierLabel} • ${isPassive ? 'Passive' : 'Active'}`,
              badgeColor: isPassive ? '#475569' : '#7C3AED',
              description: t.desc || 'Authentic Ninja Sage talent skill.',
              effects: t.effects.map(formatRawEffect),
            });
          }
        }

        // All Pets from pet.json
        for (const pet of Object.values(petsMap)) {
          if (!pet?.id) continue;
          built.push({
            id: pet.id,
            name: pet.name || pet.id,
            tab: 'pets',
            iconCategory: 'pets',
            level: Number(pet.level ?? 1),
            damage: 0,
            priceGold: 0,
            priceTokens: 0,
            badgeLabel: pet.emblem ? `🐾 Emblem Pet • Lv.${pet.level ?? 1}` : `🐾 Pet • Lv.${pet.level ?? 1}`,
            badgeColor: pet.emblem ? '#B45309' : '#059669',
            description: pet.description || 'Loyal shinobi companion pet.',
            effects: [],
            petStats: {
              agility: Number(pet.agility ?? 0),
              dodge: Number(pet.dodge ?? 0),
              critical: Number(pet.critical ?? 0),
              emblem: Boolean(pet.emblem),
            },
            petSkills: Array.isArray(pet.attacks) ? pet.attacks : [],
          });
        }

        built.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));
        if (alive) setAllAssets(built);
      } finally {
        if (alive) setAssetsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [serverUrl]);

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allAssets.filter((a) => {
      if (a.tab !== tab) return false;
      if (tab === 'element' && a.elementType !== elemFilter) return false;
      if (
        q &&
        !a.name.toLowerCase().includes(q) &&
        !a.id.toLowerCase().includes(q) &&
        !a.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allAssets, tab, elemFilter, query]);

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedAssets = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredAssets.slice(start, start + PAGE_SIZE);
  }, [filteredAssets, safePage]);

  // Capture authentic HD SWF icons for the currently visible page
  useEffect(() => {
    if (!bridgeReady || pagedAssets.length === 0) return;
    const cat = pagedAssets[0].iconCategory;
    const missing = pagedAssets
      .map((a) => a.id)
      .filter((id) => !iconUris[id] && !requestedIconsRef.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => requestedIconsRef.current.add(id));
    for (let i = 0; i < missing.length; i += 12) {
      const chunk = missing.slice(i, i + 12);
      const url = buildIconSheetSwfUrl(serverUrl, cat, chunk.join(','));
      iconBridgeRef.current?.captureSkillIcons(url, chunk);
    }
  }, [bridgeReady, pagedAssets, serverUrl, iconUris]);

  const handleBridgeEvent = (ev: StageEvent) => {
    if (ev.type === 'BRIDGE_READY') setBridgeReady(true);
    else if (ev.type === 'SKILL_ICONS' && ev.icons) {
      setIconUris((prev) => ({ ...prev, ...ev.icons }));
    }
  };

  const selectedAsset = useMemo(
    () => pagedAssets.find((a) => a.id === selectedAssetId) ?? pagedAssets[0] ?? null,
    [pagedAssets, selectedAssetId]
  );

  const switchTab = (next: MainTab) => {
    playClickSfx(serverUrl);
    setTab(next);
    setPage(1);
    setQuery('');
    if (next === 'element') {
      setElemFilter('1');
    }
  };

  return (
    <NinjaScrollWindow
      title="Shinobi Encyclopedia"
      bgSource={BUILDING_BGS.academy}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      rightContent={
        <View style={styles.countPill}>
          <Text style={styles.countTxt}>📖 {filteredAssets.length.toLocaleString()} Entries</Text>
        </View>
      }
    >
      {/* Hidden 1x1 WebView Bridge for Authentic HD SWF Icon Capture */}
      <View style={styles.hiddenBridge} pointerEvents="none">
        <RuffleStageView ref={iconBridgeRef} baseUrl={serverUrl} onEvent={handleBridgeEvent} />
      </View>

      <View style={styles.container}>
        {/* Main Horizontal Tab Strip */}
        <View style={styles.topBarRow}>
          <ScrollView showsVerticalScrollIndicator={false}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabStrip}
            style={{ flex: 1 }}
          >
            {(
              [
                ['weapon', '⚔️ Weapon'],
                ['back', '🎒 Back Item'],
                ['element', '🔥 Jutsu'],
                ['taijutsu', '🥋 Taijutsu'],
                ['genjutsu', '👁️ Genjutsu'],
                ['talent', '✨ Talents'],
                ['pets', '🐾 Pets'],
              ] as Array<[MainTab, string]>
            ).map(([k, lbl]) => (
              <Pressable
                key={k}
                style={[styles.mainTabBtn, tab === k && styles.mainTabBtnActive]}
                onPress={() => switchTab(k)}
              >
                <Text style={[styles.mainTabTxt, tab === k && styles.mainTabTxtActive]}>
                  {lbl}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={(txt) => {
              setQuery(txt);
              setPage(1);
            }}
            placeholder="Search..."
            placeholderTextColor="#7A4C24"
          />
        </View>

        {/* Sub-Filter Row for Jutsu Elements */}
        {tab === 'element' ? (
          <View style={styles.catRow}>
            {(
              [
                ['1', '💨 Wind'],
                ['2', '🔥 Fire'],
                ['3', '⚡ Lightning'],
                ['4', '🪨 Earth'],
                ['5', '💧 Water'],
              ] as Array<[ElementFilter, string]>
            ).map(([elKey, label]) => (
              <Pressable
                key={elKey}
                style={[styles.catBtn, elemFilter === elKey && styles.catBtnActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setElemFilter(elKey);
                  setPage(1);
                }}
              >
                <Text style={[styles.catTxt, elemFilter === elKey && styles.catTxtActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Split Body */}
        <View style={styles.splitBody}>
          {/* Left List Pane */}
          <View style={styles.leftCol}>
            {assetsLoading ? (
              <View style={styles.emptyCenter}>
                <ActivityIndicator color={NS_THEME.woodBorder} size="large" />
              </View>
            ) : (
              <>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gridWrap}>
                  {pagedAssets.length === 0 ? (
                    <Text style={styles.emptyTxt}>No entries found.</Text>
                  ) : (
                    pagedAssets.map((item) => {
                      const active = selectedAsset?.id === item.id;
                      const uri = iconUris[item.id];
                      return (
                        <Pressable
                          key={`${item.tab}_${item.id}`}
                          style={[styles.effectTile, active && styles.effectTileActive]}
                          onPress={() => {
                            playClickSfx(serverUrl);
                            setSelectedAssetId(item.id);
                          }}
                        >
                          <View style={styles.assetIconBox}>
                            {uri ? (
                              <Image source={{ uri }} style={styles.assetIconImg} resizeMode="contain" />
                            ) : (
                              <Text style={styles.assetFallback}>
                                {item.iconCategory === 'pets'
                                  ? '🐾'
                                  : item.iconCategory === 'skills'
                                  ? '📜'
                                  : '⚔️'}
                              </Text>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.tileName} numberOfLines={1}>
                              {item.name}
                            </Text>
                            <Text style={styles.tileCat} numberOfLines={1}>
                              {item.badgeLabel}
                              {item.damage > 0 ? ` • DMG ${item.damage}` : ''}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>

                {totalPages > 1 ? (
                  <View style={styles.pageBar}>
                    <Pressable
                      style={[styles.pageBtn, safePage <= 1 && styles.pageBtnDisabled]}
                      disabled={safePage <= 1}
                      onPress={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <Text style={styles.pageBtnTxt}>◀ Prev</Text>
                    </Pressable>
                    <Text style={styles.pageInfo}>
                      Page {safePage} / {totalPages}
                    </Text>
                    <Pressable
                      style={[styles.pageBtn, safePage >= totalPages && styles.pageBtnDisabled]}
                      disabled={safePage >= totalPages}
                      onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <Text style={styles.pageBtnTxt}>Next ▶</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </View>

          {/* Right Detail Pane */}
          <View style={styles.rightCol}>
            {selectedAsset ? (
              <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.detailCard} contentContainerStyle={{ gap: 9, paddingBottom: 12 }}>
                <View style={styles.detailHeader}>
                  <View style={styles.detailAssetIconBig}>
                    {iconUris[selectedAsset.id] ? (
                      <Image
                        source={{ uri: iconUris[selectedAsset.id] }}
                        style={styles.detailAssetImg}
                        resizeMode="contain"
                      />
                    ) : (
                      <Text style={styles.detailIconTxt}>
                        {selectedAsset.iconCategory === 'pets'
                          ? '🐾'
                          : selectedAsset.iconCategory === 'skills'
                          ? '📜'
                          : '⚔️'}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle}>{selectedAsset.name}</Text>
                    <View style={[styles.typeBadge, { backgroundColor: selectedAsset.badgeColor }]}>
                      <Text style={styles.typeBadgeTxt}>{selectedAsset.badgeLabel}</Text>
                    </View>
                  </View>
                  {(selectedAsset.iconCategory === 'skills' && !selectedAsset.isPassiveTalent) ||
                  selectedAsset.iconCategory === 'pets' ? (
                    <Pressable
                      style={styles.previewBtn}
                      onPress={() => {
                        playClickSfx(serverUrl);
                        setPreviewTarget({
                          id: selectedAsset.id,
                          name: selectedAsset.name,
                          kind: selectedAsset.iconCategory === 'pets' ? 'pets' : 'skills',
                        });
                      }}
                    >
                      <Text style={styles.previewBtnTxt}>🎬 Preview</Text>
                    </Pressable>
                  ) : null}
                </View>

                {/* Stats Chips (hidden for passive talents — passive talents only show icon & description!) */}
                {!selectedAsset.isPassiveTalent ? (
                <View style={styles.statChips}>
                  <Text style={styles.statChip}>ID: {selectedAsset.id}</Text>
                  {selectedAsset.damage > 0 ? (
                    <Text style={styles.statChip}>⚔️ DMG: {selectedAsset.damage}</Text>
                  ) : null}
                  {selectedAsset.cpCost !== undefined ? (
                    <Text style={styles.statChip}>💧 CP: {selectedAsset.cpCost}</Text>
                  ) : null}
                  {selectedAsset.cooldown !== undefined ? (
                    <Text style={styles.statChip}>⏱️ CD: {selectedAsset.cooldown}t</Text>
                  ) : null}
                  {selectedAsset.priceGold > 0 ? (
                    <Text style={styles.statChip}>
                      🪙 {selectedAsset.priceGold.toLocaleString()}
                    </Text>
                  ) : null}
                  {selectedAsset.priceTokens > 0 ? (
                    <Text style={styles.statChip}>
                      💎 {selectedAsset.priceTokens.toLocaleString()}
                    </Text>
                  ) : null}
                  {selectedAsset.petStats ? (
                    <>
                      <Text style={styles.statChip}>⚡ AGI: {selectedAsset.petStats.agility}</Text>
                      <Text style={styles.statChip}>💨 DODGE: {selectedAsset.petStats.dodge}%</Text>
                      <Text style={styles.statChip}>💥 CRIT: {selectedAsset.petStats.critical}%</Text>
                    </>
                  ) : null}
                </View>
                ) : null}

                <View style={styles.descBox}>
                  <Text style={styles.descHeading}>Description</Text>
                  <Text style={styles.descBody}>{selectedAsset.description}</Text>
                </View>

                {selectedAsset.effects.length > 0 ? (
                  <View style={styles.mechBox}>
                    <Text style={styles.mechHeading}>Special Effects</Text>
                    {selectedAsset.effects.map((eff, idx) => (
                      <Text key={idx} style={styles.mechBody}>
                        • {eff}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {selectedAsset.petSkills && selectedAsset.petSkills.length > 0 ? (
                  <View style={styles.mechBox}>
                    <Text style={styles.mechHeading}>Pet Skills ({selectedAsset.petSkills.length})</Text>
                    {selectedAsset.petSkills.map((ps, idx) => (
                      <View key={idx} style={styles.petSkillRow}>
                        <Text style={styles.petSkillTitle}>
                          Lv.{ps.level} • {ps.name} {ps.cooldown > 0 ? `(CD ${ps.cooldown}t)` : ''}
                        </Text>
                        <Text style={styles.mechBody}>{ps.description}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </ScrollView>
            ) : (
              <View style={styles.emptyCenter}>
                <Text style={styles.emptyTxt}>Select an entry to view details.</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <JutsuPreviewModal
        visible={previewTarget !== null}
        title={previewTarget?.name ?? 'Preview'}
        skillId={previewTarget?.kind === 'skills' ? previewTarget.id : null}
        swfUrl={
          previewTarget
            ? previewTarget.kind === 'pets'
              ? buildSwfAssetUrl(serverUrl, 'pets', previewTarget.id, 'standby')
              : buildSwfAssetUrl(serverUrl, 'skills', previewTarget.id)
            : null
        }
        serverUrl={serverUrl}
        onClose={() => setPreviewTarget(null)}
      />
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  hiddenBridge: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
    left: -10,
    top: -10,
  },
  container: { flex: 1, gap: 6 },
  countPill: {
    backgroundColor: '#3E2008',
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countTxt: { color: '#FFE082', fontWeight: '800', fontSize: 11.5 },
  topBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabStrip: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  mainTabBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
  },
  mainTabBtnActive: { backgroundColor: NS_THEME.tabActive, borderColor: '#FFE082' },
  mainTabTxt: { color: '#FFF4DC', fontWeight: '800', fontSize: 11.5 },
  mainTabTxtActive: { color: '#FFFFFF', fontWeight: '900' },
  searchInput: {
    width: 150,
    backgroundColor: '#FFF7E0',
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    color: NS_THEME.inkDark,
    fontSize: 11.5,
    fontWeight: '700',
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  catBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 7,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
  },
  catBtnActive: { backgroundColor: '#D95B16', borderColor: '#FFE082' },
  catTxt: { color: NS_THEME.inkDark, fontWeight: '800', fontSize: 10.5 },
  catTxtActive: { color: '#FFFFFF' },
  splitBody: { flex: 1, flexDirection: 'row', gap: 10 },
  leftCol: { flex: 1.15, gap: 5 },
  rightCol: { flex: 1.1 },
  gridWrap: { gap: 5, paddingBottom: 8 },
  effectTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 9,
    padding: 6,
  },
  effectTileActive: {
    backgroundColor: NS_THEME.parchmentSelected,
    borderColor: '#D95B16',
    borderWidth: 2,
  },
  assetIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#231309',
    borderWidth: 1.5,
    borderColor: '#D9A438',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  assetIconImg: { width: 34, height: 34 },
  assetFallback: { fontSize: 16 },
  tileName: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 12 },
  tileCat: { color: NS_THEME.inkSoft, fontWeight: '700', fontSize: 9.5, marginTop: 1 },
  pageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pageBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 10.5 },
  pageInfo: { color: NS_THEME.inkDark, fontWeight: '800', fontSize: 11 },
  detailCard: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 11,
    padding: 11,
  },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailAssetIconBig: {
    width: 54,
    height: 54,
    borderRadius: 11,
    backgroundColor: '#231309',
    borderWidth: 2,
    borderColor: '#FACC15',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  detailAssetImg: { width: 48, height: 48 },
  detailIconTxt: { fontSize: 24 },
  detailTitle: { color: NS_THEME.inkDark, fontWeight: '900', fontSize: 15 },
  previewBtn: {
    backgroundColor: NS_THEME.btnBlue,
    borderWidth: 1.5,
    borderColor: '#FFE082',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewBtnTxt: { color: '#FFFFFF', fontWeight: '900', fontSize: 11 },
  typeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 3,
  },
  typeBadgeTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 10 },
  statChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  statChip: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    color: NS_THEME.inkDark,
    fontWeight: '800',
    fontSize: 10.5,
  },
  descBox: {
    backgroundColor: '#FFF7E0',
    borderWidth: 1.25,
    borderColor: '#D9A438',
    borderRadius: 8,
    padding: 9,
    gap: 3,
  },
  descHeading: { color: '#92400E', fontWeight: '900', fontSize: 10.5 },
  descBody: { color: NS_THEME.inkDark, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  mechBox: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 8,
    padding: 9,
    gap: 5,
  },
  mechHeading: { color: NS_THEME.inkMid, fontWeight: '900', fontSize: 10.5 },
  mechBody: { color: NS_THEME.inkSoft, fontSize: 11.5, lineHeight: 16, fontWeight: '700' },
  petSkillRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(110, 62, 22, 0.2)',
    paddingTop: 4,
    gap: 2,
  },
  petSkillTitle: { color: NS_THEME.inkDark, fontSize: 11.5, fontWeight: '900' },
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { color: NS_THEME.inkSoft, fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 14 },
});
