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
import { MobileApiClient, type TalentCatalogItem } from '../api/client';
import { playClickSfx } from '../audio/audioManager';
import { BUILDING_BGS } from '../components/BuildingSceneBackdrop';
import { NinjaScrollWindow, NS_THEME } from '../components/NinjaScrollWindow';
import { NinjaToast } from '../components/NinjaToast';
import { useAuthStore } from '../store/useAuthStore';

interface OwnedTalentSkill {
  item_id: string;
  item_level: number;
}

type TalentSlotKey = 'extreme' | 'secret1' | 'secret2';

interface TalentTreeNode {
  order: number;
  baseSkillId: string;
  name: string;
  desc: string;
  level: number;
}

export function TalentScreen() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const profile = useAuthStore((s) => s.profile);
  const setProfileFromRaw = useAuthStore((s) => s.setProfileFromRaw);
  const navigate = useAuthStore((s) => s.navigate);

  const api = useMemo(() => new MobileApiClient(serverUrl), [serverUrl]);

  const [activeSlot, setActiveSlot] = useState<TalentSlotKey>('extreme');
  const [selectedNodeOrder, setSelectedNodeOrder] = useState<number>(1);
  const [selectedDiscoverId, setSelectedDiscoverId] = useState<string>('');
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [ownedSkills, setOwnedSkills] = useState<OwnedTalentSkill[]>([]);
  const [catalog, setCatalog] = useState<TalentCatalogItem[]>([]);
  const [talentDesc, setTalentDesc] = useState<
    Record<string, { talent_skill_id?: string; talent_skill_name?: string; talent_skill_order?: number; talent_skill_description?: string }>
  >({});
  const [tpCosts, setTpCosts] = useState<Record<string, number>>({});

  // Auto-dismiss notification after 2 seconds
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2000);
    return () => clearTimeout(t);
  }, [message]);

  const loadAll = useCallback(async () => {
    if (!profile || !sessionKey) return;
    setLoading(true);
    try {
      const [tsRes, feat] = await Promise.all([
        api.rpc<{ status: number; data?: OwnedTalentSkill[] }>(
          'TalentService',
          'getTalentSkills',
          [profile.charId, sessionKey],
          { sessionKey, charId: profile.charId }
        ),
        api.getFeatureData(),
      ]);
      setOwnedSkills(tsRes.data?.data ?? []);
      setCatalog(feat.talents_catalog ?? []);
      setTalentDesc(feat.talent_description ?? {});
      setTpCosts(feat.talent_tp_cost ?? {});
    } catch (err) {
      setMessage(`Failed to load Talents: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, profile, sessionKey]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshAll = async () => {
    if (!profile || !sessionKey) return;
    const raw = await api.getCharacter(profile.charId, sessionKey);
    setProfileFromRaw(profile.charId, raw);
    await loadAll();
  };

  const discoverableTrees = useMemo(
    () => catalog.filter((t) => !t.talent_id.startsWith('skill_')),
    [catalog]
  );

  const treesById = useMemo(() => {
    const map: Record<string, TalentCatalogItem> = {};
    for (const t of discoverableTrees) map[t.talent_id] = t;
    return map;
  }, [discoverableTrees]);

  const skillInfoByIdLv = useMemo(() => {
    const map: Record<string, TalentCatalogItem> = {};
    for (const t of catalog) {
      if (t.talent_id.startsWith('skill_')) {
        map[t.talent_id] = t;
      }
    }
    return map;
  }, [catalog]);

  const ownedLevelMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const os of ownedSkills) map[os.item_id] = os.item_level;
    return map;
  }, [ownedSkills]);

  const slotTalentId: Record<TalentSlotKey, string> = {
    extreme: profile?.talent1 || '',
    secret1: profile?.talent2 || '',
    secret2: profile?.talent3 || '',
  };

  const unlockedTrees = useMemo(
    () => [profile?.talent1, profile?.talent2, profile?.talent3].filter((v): v is string => Boolean(v)),
    [profile?.talent1, profile?.talent2, profile?.talent3]
  );

  const activeTreeId = slotTalentId[activeSlot];
  const activeTreeMeta = activeTreeId ? treesById[activeTreeId] : undefined;

  // Build authentic 6-node diamond tree (orders 1..6) for any talent tree ID
  const getTreeNodes = useCallback(
    (treeId: string): TalentTreeNode[] => {
      if (!treeId) return [];
      const nodes: TalentTreeNode[] = [];
      for (let order = 1; order <= 6; order++) {
        const entry = talentDesc[`talent_${treeId}_skill_${order}`];
        if (!entry?.talent_skill_id) continue;
        const baseId = entry.talent_skill_id;
        const curLv = ownedLevelMap[baseId] ?? 0;
        const lookup = skillInfoByIdLv[`${baseId}:${Math.max(1, curLv)}`] ?? skillInfoByIdLv[`${baseId}:1`];
        nodes.push({
          order,
          baseSkillId: baseId,
          name: lookup?.name ?? entry.talent_skill_name ?? baseId,
          desc: lookup?.description ?? entry.talent_skill_description ?? '',
          level: curLv,
        });
      }
      return nodes;
    },
    [talentDesc, ownedLevelMap, skillInfoByIdLv]
  );

  const activeNodes = useMemo(() => getTreeNodes(activeTreeId), [getTreeNodes, activeTreeId]);
  const nodeByOrder = useMemo(() => {
    const m: Record<number, TalentTreeNode> = {};
    for (const n of activeNodes) m[n.order] = n;
    return m;
  }, [activeNodes]);

  const selectedNode = nodeByOrder[selectedNodeOrder] ?? activeNodes[0] ?? null;

  // Keep selectedDiscoverId initialized to first non-unlocked tree
  useEffect(() => {
    if (!selectedDiscoverId && discoverableTrees.length > 0) {
      const firstAvail = discoverableTrees.find((t) => !unlockedTrees.includes(t.talent_id)) ?? discoverableTrees[0];
      setSelectedDiscoverId(firstAvail.talent_id);
    }
  }, [discoverableTrees, unlockedTrees, selectedDiscoverId]);

  const selectedDiscoverTree = treesById[selectedDiscoverId] ?? discoverableTrees[0] ?? null;
  const discoverPreviewNodes = useMemo(
    () => (selectedDiscoverTree ? getTreeNodes(selectedDiscoverTree.talent_id) : []),
    [getTreeNodes, selectedDiscoverTree]
  );

  const handleDiscover = async (tree: TalentCatalogItem, mode: 'Extreme' | 'Secret') => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(`disc-${tree.talent_id}`);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'TalentService',
        'discoverTalent',
        [profile.charId, sessionKey, mode, tree.talent_id],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage(`Unlocked ${tree.name} (${mode})!`);
        setSelectedNodeOrder(1);
        await refreshAll();
      } else {
        setMessage(res.data?.result || res.data?.error || 'Failed to unlock talent.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleUpgrade = async (baseSkillId: string, isMax: boolean) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(`up-${baseSkillId}`);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'TalentService',
        'upgradeSkill',
        [profile.charId, sessionKey, baseSkillId, isMax],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        setMessage(res.data?.result || 'Talent skill upgraded!');
        await refreshAll();
      } else {
        setMessage(res.data?.result || res.data?.error || 'Not enough TP.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleResetTalent = async (talentId: string) => {
    if (!profile || !sessionKey) return;
    playClickSfx(serverUrl);
    setBusyId(`reset-${talentId}`);
    setMessage(null);
    try {
      const res = await api.rpc<{ status: number; result?: string; error?: string }>(
        'TalentService',
        'resetTalents',
        [profile.charId, sessionKey, [talentId]],
        { sessionKey, charId: profile.charId }
      );
      if (res.data?.status === 1) {
        const tName = treesById[talentId]?.name ?? talentId;
        setResetModalOpen(false);
        setMessage(`Talent ${tName} has been reset!`);
        await refreshAll();
      } else {
        setMessage(res.data?.result || res.data?.error || 'Failed to reset talent.');
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyId(null);
    }
  };

  const renderTreeNode = (order: number) => {
    const node = nodeByOrder[order];
    if (!node) return <View style={styles.nodePlaceholder} />;
    const isSelected = selectedNode?.order === order;
    const isLearned = node.level > 0;
    const isMax = node.level >= 10;
    return (
      <Pressable
        style={[
          styles.treeNode,
          isLearned && styles.treeNodeLearned,
          isMax && styles.treeNodeMax,
          isSelected && styles.treeNodeSelected,
        ]}
        onPress={() => {
          playClickSfx(serverUrl);
          setSelectedNodeOrder(order);
        }}
      >
        <Text style={styles.nodeTierTxt}>T{order}</Text>
        <Text style={styles.nodeNameTxt} numberOfLines={2}>
          {node.name}
        </Text>
        <View style={[styles.nodeLvPill, isMax && styles.nodeLvPillMax]}>
          <Text style={styles.nodeLvTxt}>Lv.{node.level}/10</Text>
        </View>
      </Pressable>
    );
  };

  const slotLabelMap: Array<{ key: TalentSlotKey; tag: string; mode: 'Extreme' | 'Secret' }> = [
    { key: 'extreme', tag: 'Extreme', mode: 'Extreme' },
    { key: 'secret1', tag: 'Secret 1', mode: 'Secret' },
    { key: 'secret2', tag: 'Secret 2', mode: 'Secret' },
  ];

  const activeSlotMode: 'Extreme' | 'Secret' = activeSlot === 'extreme' ? 'Extreme' : 'Secret';

  return (
    <NinjaScrollWindow
      title="Talent"
      bgSource={BUILDING_BGS.talentHall}
      onClose={() => {
        playClickSfx(serverUrl);
        navigate('hub');
      }}
      headerCenter={
        <View style={styles.headerTabsRow}>
          {slotLabelMap.map((s) => {
            const tid = slotTalentId[s.key];
            const tName = tid ? treesById[tid]?.name ?? tid.toUpperCase() : 'Empty';
            const isAct = activeSlot === s.key;
            return (
              <Pressable
                key={s.key}
                style={[styles.slotTab, isAct && styles.slotTabActive]}
                onPress={() => {
                  playClickSfx(serverUrl);
                  setActiveSlot(s.key);
                  setSelectedNodeOrder(1);
                }}
              >
                <Text style={[styles.slotTabTop, isAct && styles.slotTabTxtActive]}>{s.tag}</Text>
                <Text style={[styles.slotTabSub, isAct && styles.slotTabTxtActive]} numberOfLines={1}>
                  {tName}
                </Text>
              </Pressable>
            );
          })}
          {unlockedTrees.length > 0 ? (
            <Pressable
              style={styles.resetHeaderBtn}
              onPress={() => {
                playClickSfx(serverUrl);
                setResetModalOpen(true);
              }}
            >
              <Text style={styles.resetHeaderTxt}>🔄 Reset</Text>
            </Pressable>
          ) : null}
        </View>
      }
      rightContent={
        <View style={styles.currencyPill}>
          <Text style={styles.currencyTxt}>
            ✨ {(profile?.tp ?? 0).toLocaleString()} TP • 🪙 {(profile?.gold ?? 0).toLocaleString()}
          </Text>
        </View>
      }
    >
      <NinjaToast message={message} />

      {loading ? (
        <ActivityIndicator color={NS_THEME.btnOrange} style={{ marginTop: 28 }} />
      ) : activeTreeId ? (
        /* AUTHENTIC NINJA SAGA 6-NODE DIAMOND TALENT TREE */
        <View style={styles.splitBody}>
          <View style={styles.treePane}>
            <View style={styles.treeHeader}>
              <Text style={styles.treeTitle}>
                ✨ {activeTreeMeta?.name ?? activeTreeId.toUpperCase()} ({activeSlotMode})
              </Text>
              <Text style={styles.treeHint}>Tap node to inspect & upgrade</Text>
            </View>

            <View style={styles.diamondWrap}>
              {/* Tier 1: Root Node */}
              <View style={styles.diamondRowCenter}>{renderTreeNode(1)}</View>

              {/* Branch Connectors */}
              <View style={styles.branchSplit}>
                <View style={styles.branchStemV} />
                <View style={styles.branchBarH} />
                <View style={styles.branchLegsRow}>
                  <View style={styles.branchStemV} />
                  <View style={styles.branchStemV} />
                </View>
              </View>

              {/* Tier 2: Left & Right Branches */}
              <View style={styles.diamondRowPair}>
                {renderTreeNode(2)}
                {renderTreeNode(3)}
              </View>

              {/* Vertical Pair Connectors */}
              <View style={styles.pairConnectors}>
                <View style={styles.branchStemV} />
                <View style={styles.branchStemV} />
              </View>

              {/* Tier 3: Lower Left & Right Branches */}
              <View style={styles.diamondRowPair}>
                {renderTreeNode(4)}
                {renderTreeNode(5)}
              </View>

              {/* Converge Connectors */}
              <View style={styles.branchSplit}>
                <View style={styles.branchLegsRow}>
                  <View style={styles.branchStemV} />
                  <View style={styles.branchStemV} />
                </View>
                <View style={styles.branchBarH} />
                <View style={styles.branchStemV} />
              </View>

              {/* Tier 4: Ultimate Node */}
              <View style={styles.diamondRowCenter}>{renderTreeNode(6)}</View>
            </View>
          </View>

          {/* Right Pane: Selected Node Details + Upgrade Controls */}
          <View style={styles.detailPane}>
            {selectedNode ? (
              <>
                <View style={styles.detailTop}>
                  <Text style={styles.detailSkillTitle}>{selectedNode.name}</Text>
                  <View style={styles.detailLvBadge}>
                    <Text style={styles.detailLvTxt}>Lv.{selectedNode.level} / 10</Text>
                  </View>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.detailDescScroll}>
                  <Text style={styles.detailDesc}>
                    {selectedNode.desc || 'Passive / active shinobi talent technique.'}
                  </Text>
                </ScrollView>

                <View style={styles.upgradeBox}>
                  {selectedNode.level >= 10 ? (
                    <View style={styles.maxDonePill}>
                      <Text style={styles.maxDoneTxt}>★ MAX LEVEL REACHED</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.nextCostTxt}>
                        Next Level Cost: {tpCosts[String(selectedNode.level + 1)] ?? 5} TP
                      </Text>
                      <View style={styles.upBtnRow}>
                        <Pressable
                          style={styles.upBtn}
                          disabled={busyId !== null}
                          onPress={() => handleUpgrade(selectedNode.baseSkillId, false)}
                        >
                          <Text style={styles.btnText}>
                            {busyId === `up-${selectedNode.baseSkillId}`
                              ? 'Upgrading...'
                              : `+1 Level (${tpCosts[String(selectedNode.level + 1)] ?? 5} TP)`}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[styles.upBtn, styles.upMaxBtn]}
                          disabled={busyId !== null}
                          onPress={() => handleUpgrade(selectedNode.baseSkillId, true)}
                        >
                          <Text style={styles.btnText}>MAX</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              </>
            ) : (
              <Text style={styles.emptyText}>Select a talent node on the tree.</Text>
            )}
          </View>
        </View>
      ) : (
        /* EMPTY SLOT: AUTHENTIC NINJA SAGA DISCOVER TALENT CATALOG */
        <View style={styles.splitBody}>
          <View style={styles.discoverListPane}>
            <Text style={styles.treeTitle}>Discover {activeSlotMode} Talent</Text>
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.discoverList}>
              {discoverableTrees.map((t) => {
                const alreadyOwned = unlockedTrees.includes(t.talent_id);
                const isSel = selectedDiscoverTree?.talent_id === t.talent_id;
                return (
                  <Pressable
                    key={t.talent_id}
                    style={[
                      styles.discoverRow,
                      alreadyOwned && styles.discoverRowOwned,
                      isSel && styles.discoverRowSel,
                    ]}
                    onPress={() => {
                      playClickSfx(serverUrl);
                      setSelectedDiscoverId(t.talent_id);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.discoverName} numberOfLines={1}>
                        {t.name} {t.is_emblem ? '👑' : ''}
                      </Text>
                      <Text style={styles.discoverCost}>
                        {t.price_gold > 0 ? `${t.price_gold.toLocaleString()} Gold` : ''}
                        {t.price_gold > 0 && t.price_tokens > 0 ? ' • ' : ''}
                        {t.price_tokens > 0 ? `${t.price_tokens.toLocaleString()} Tokens` : ''}
                      </Text>
                    </View>
                    {alreadyOwned ? (
                      <Text style={styles.ownedTag}>OWNED</Text>
                    ) : (
                      <Text style={styles.arrowTag}>▶</Text>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.detailPane}>
            {selectedDiscoverTree ? (
              <>
                <View style={styles.detailTop}>
                  <Text style={styles.detailSkillTitle}>
                    {selectedDiscoverTree.name} {selectedDiscoverTree.is_emblem ? '👑' : ''}
                  </Text>
                </View>
                <Text style={styles.discoverCostBig}>
                  {selectedDiscoverTree.price_gold > 0
                    ? `🪙 ${selectedDiscoverTree.price_gold.toLocaleString()} Gold`
                    : ''}
                  {selectedDiscoverTree.price_gold > 0 && selectedDiscoverTree.price_tokens > 0
                    ? '  •  '
                    : ''}
                  {selectedDiscoverTree.price_tokens > 0
                    ? `💎 ${selectedDiscoverTree.price_tokens.toLocaleString()} Tokens`
                    : ''}
                </Text>
                <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.detailDescScroll}>
                  <Text style={styles.detailDesc}>
                    {selectedDiscoverTree.description || 'Secret Ninja Talent.'}
                  </Text>
                  {discoverPreviewNodes.length > 0 ? (
                    <View style={styles.previewNodesBox}>
                      <Text style={styles.previewNodesTitle}>TALENT TREE SKILLS</Text>
                      {discoverPreviewNodes.map((n) => (
                        <Text key={n.order} style={styles.previewNodeLine}>
                          {n.order}. {n.name}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </ScrollView>

                <Pressable
                  style={[
                    styles.discoverBtn,
                    unlockedTrees.includes(selectedDiscoverTree.talent_id) && styles.discoverBtnDone,
                  ]}
                  disabled={
                    busyId !== null || unlockedTrees.includes(selectedDiscoverTree.talent_id)
                  }
                  onPress={() => handleDiscover(selectedDiscoverTree, activeSlotMode)}
                >
                  <Text style={styles.btnText}>
                    {unlockedTrees.includes(selectedDiscoverTree.talent_id)
                      ? '✓ Already Unlocked'
                      : busyId === `disc-${selectedDiscoverTree.talent_id}`
                        ? 'Unlocking...'
                        : `✨ Unlock as ${activeSlotMode} Talent`}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      )}

      {/* Reset Talent Modal */}
      <Modal
        visible={resetModalOpen}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => {
          if (busyId === null) setResetModalOpen(false);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => busyId === null && setResetModalOpen(false)}
        >
          <Pressable style={styles.resetModalCard} onPress={() => {}}>
            <View style={styles.resetModalHeader}>
              <Text style={styles.resetModalTitle}>🔄 Reset Talent</Text>
              <Pressable
                style={styles.resetCloseBtn}
                disabled={busyId !== null}
                onPress={() => setResetModalOpen(false)}
              >
                <Text style={styles.resetCloseTxt}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.resetModalDesc}>
              Select an unlocked talent to reset. The slot will be cleared so you can discover a new talent.
            </Text>
            <View style={styles.resetList}>
              {slotLabelMap
                .filter((s) => Boolean(slotTalentId[s.key]))
                .map((s) => {
                  const tid = slotTalentId[s.key];
                  const tName = treesById[tid]?.name ?? tid.toUpperCase();
                  const isBusy = busyId === `reset-${tid}`;
                  return (
                    <Pressable
                      key={s.key}
                      style={styles.resetChoiceBtn}
                      disabled={busyId !== null}
                      onPress={() => handleResetTalent(tid)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.resetChoiceTag}>{s.tag.toUpperCase()}</Text>
                        <Text style={styles.resetChoiceName}>{tName}</Text>
                      </View>
                      <Text style={styles.resetChoiceAct}>
                        {isBusy ? 'Resetting...' : 'Reset'}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </NinjaScrollWindow>
  );
}

const styles = StyleSheet.create({
  headerTabsRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  slotTab: {
    backgroundColor: NS_THEME.tabInactive,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 74,
    alignItems: 'center',
  },
  slotTabActive: { backgroundColor: NS_THEME.tabActive, borderColor: NS_THEME.woodBorderDark },
  slotTabTop: { color: NS_THEME.inkSoft, fontSize: 8, fontWeight: '900' },
  slotTabSub: { color: NS_THEME.inkDark, fontSize: 9.5, fontWeight: '900', maxWidth: 84 },
  slotTabTxtActive: { color: '#FFF' },
  resetHeaderBtn: {
    backgroundColor: NS_THEME.btnRed,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  resetHeaderTxt: { color: '#FFF', fontSize: 9.5, fontWeight: '900' },
  currencyPill: {
    backgroundColor: '#3E2008',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.goldTrim,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  currencyTxt: { color: '#FDE047', fontSize: 10, fontWeight: '900' },
  banner: {
    backgroundColor: '#FEF3C7',
    borderColor: '#B45309',
    borderWidth: 1.5,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 5,
  },
  bannerText: { color: '#78350F', fontSize: 11, fontWeight: '800' },
  splitBody: { flex: 1, flexDirection: 'row', gap: 8 },
  treePane: {
    flex: 1.2,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 8,
    justifyContent: 'space-between',
  },
  treeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  treeTitle: { color: NS_THEME.inkDark, fontSize: 11.5, fontWeight: '900' },
  treeHint: { color: NS_THEME.inkSoft, fontSize: 9, fontWeight: '700' },
  diamondWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diamondRowCenter: { alignItems: 'center', justifyContent: 'center' },
  diamondRowPair: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '88%',
    gap: 16,
  },
  branchSplit: { alignItems: 'center', width: '58%' },
  branchStemV: { width: 2.5, height: 8, backgroundColor: NS_THEME.woodBorder },
  branchBarH: { width: '100%', height: 2.5, backgroundColor: NS_THEME.woodBorder },
  branchLegsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  pairConnectors: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '58%',
  },
  treeNode: {
    width: 118,
    minHeight: 44,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  treeNodeLearned: { borderColor: NS_THEME.btnGreen, backgroundColor: '#E7F6E5' },
  treeNodeMax: { borderColor: '#D97706', backgroundColor: '#FEF3C7' },
  treeNodeSelected: { borderColor: NS_THEME.btnOrange, borderWidth: 2.5 },
  nodePlaceholder: { width: 118, height: 44 },
  nodeTierTxt: {
    position: 'absolute',
    top: 2,
    left: 4,
    color: NS_THEME.inkSoft,
    fontSize: 7.5,
    fontWeight: '900',
  },
  nodeNameTxt: {
    color: NS_THEME.inkDark,
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
  },
  nodeLvPill: {
    backgroundColor: '#3E2008',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  nodeLvPillMax: { backgroundColor: '#15803D' },
  nodeLvTxt: { color: '#FDE047', fontSize: 7.5, fontWeight: '900' },
  detailPane: {
    flex: 1,
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 10,
    justifyContent: 'space-between',
    gap: 8,
  },
  detailTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110, 62, 22, 0.3)',
    paddingBottom: 6,
  },
  detailSkillTitle: { color: NS_THEME.inkDark, fontSize: 13, fontWeight: '900', flex: 1 },
  detailLvBadge: {
    backgroundColor: NS_THEME.btnOrange,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  detailLvTxt: { color: '#FFF', fontSize: 10, fontWeight: '900' },
  detailDescScroll: { flex: 1 },
  detailDesc: { color: NS_THEME.inkMid, fontSize: 11, fontWeight: '600', lineHeight: 16 },
  upgradeBox: {
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 8,
    borderWidth: 1.25,
    borderColor: NS_THEME.woodBorder,
    padding: 8,
    gap: 6,
  },
  nextCostTxt: { color: '#9A3412', fontSize: 10.5, fontWeight: '900' },
  upBtnRow: { flexDirection: 'row', gap: 6 },
  upBtn: {
    flex: 1,
    backgroundColor: NS_THEME.btnGreen,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: 'center',
  },
  upMaxBtn: { flex: 0.45, backgroundColor: NS_THEME.btnPurple },
  btnText: { color: '#FFF', fontSize: 10.5, fontWeight: '900' },
  maxDonePill: {
    backgroundColor: '#DCFCE7',
    borderColor: NS_THEME.btnGreen,
    borderWidth: 1.5,
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: 'center',
  },
  maxDoneTxt: { color: '#15803D', fontSize: 11, fontWeight: '900' },
  discoverListPane: {
    flex: 1.15,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    padding: 8,
    gap: 6,
  },
  discoverList: { gap: 5, paddingBottom: 10 },
  discoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  discoverRowOwned: { borderColor: NS_THEME.btnGreen, backgroundColor: '#E7F6E5' },
  discoverRowSel: { borderColor: NS_THEME.btnOrange, borderWidth: 2, backgroundColor: NS_THEME.parchmentSelected },
  discoverName: { color: NS_THEME.inkDark, fontSize: 11, fontWeight: '900' },
  discoverCost: { color: '#B45309', fontSize: 9, fontWeight: '800', marginTop: 1 },
  discoverCostBig: { color: '#9A3412', fontSize: 11, fontWeight: '900' },
  ownedTag: { color: '#15803D', fontSize: 9, fontWeight: '900' },
  arrowTag: { color: NS_THEME.btnOrange, fontSize: 11, fontWeight: '900' },
  previewNodesBox: {
    marginTop: 8,
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: NS_THEME.woodBorder,
    padding: 7,
    gap: 2,
  },
  previewNodesTitle: { color: NS_THEME.inkSoft, fontSize: 8.5, fontWeight: '900', marginBottom: 2 },
  previewNodeLine: { color: NS_THEME.inkDark, fontSize: 9.5, fontWeight: '700' },
  discoverBtn: {
    backgroundColor: NS_THEME.btnOrange,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorderDark,
    borderRadius: 7,
    paddingVertical: 8,
    alignItems: 'center',
  },
  discoverBtnDone: { backgroundColor: NS_THEME.btnBlue, opacity: 0.8 },
  emptyText: { color: NS_THEME.inkMid, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 24 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  resetModalCard: {
    width: 340,
    maxWidth: '92%',
    backgroundColor: NS_THEME.parchmentCard,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: NS_THEME.woodBorderDark,
    padding: 12,
    gap: 10,
  },
  resetModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resetModalTitle: { color: NS_THEME.inkDark, fontSize: 13.5, fontWeight: '900' },
  resetCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NS_THEME.btnRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetCloseTxt: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  resetModalDesc: { color: NS_THEME.inkMid, fontSize: 10.5, fontWeight: '600', lineHeight: 15 },
  resetList: { gap: 6 },
  resetChoiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NS_THEME.parchmentCardAlt,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: NS_THEME.woodBorder,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  resetChoiceTag: { color: NS_THEME.inkSoft, fontSize: 8.5, fontWeight: '900' },
  resetChoiceName: { color: NS_THEME.inkDark, fontSize: 12, fontWeight: '900' },
  resetChoiceAct: {
    backgroundColor: NS_THEME.btnRed,
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
