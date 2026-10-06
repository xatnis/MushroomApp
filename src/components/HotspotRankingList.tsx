import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { Card, StatusPill, commonStyles } from './ui';
import { useLocationConditions } from '../services/heatmap/useLocationConditions';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import type { Hotspot, FindRecord, MushroomWeatherProfileId } from '../domain/types';
import { createRankingOrderCoalescer, rankingDetailParams, rankingScore, sortHotspots,
  type ConditionsTargetContext, type HotspotSortMode } from '../domain/hotspotRanking';
import { colors, radii, spacing } from '../theme';

/** Child owns progress/order updates so ranking cannot update native heatmap sources. */
export function HotspotRankingList({ hotspots, finds, context, onContext }: {
  hotspots: Hotspot[]; finds: FindRecord[]; context: ConditionsTargetContext;
  onContext: (context: ConditionsTargetContext) => void;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [sort, setSort] = useState<HotspotSortMode>('recent');
  const { assessments, loading, error, retry } = useLocationConditions(hotspots, context.targetProfile, context.dayMode, true, 250);
  const scoreKey = JSON.stringify(hotspots.map(h => [h.id, h.title, rankingScore(assessments[h.id])]));
  const nextOrder = useMemo(() => sortHotspots(hotspots, assessments, sort).map(h => h.id), [hotspots, scoreKey, sort]);
  const key = JSON.stringify([context.targetProfile, context.dayMode, sort, hotspots.map(h => h.id)]);
  const [published, setPublished] = useState(() => ({ key, ids: nextOrder }));
  const coalescer = useMemo(() => createRankingOrderCoalescer(setPublished), []);
  useEffect(() => {
    if (sort === 'conditions') coalescer.update({ key, ids: nextOrder });
    else coalescer.cancel();
  }, [coalescer, key, nextOrder, sort]);
  useEffect(() => () => coalescer.cancel(), [coalescer]);
  // Rows/labels always use the latest snapshot; only progressive order changes are coalesced.
  const byId = useMemo(() => new Map(hotspots.map(h => [h.id, h])), [hotspots]);
  const ids = sort !== 'conditions' || published.key !== key ? nextOrder : published.ids;
  const rows = ids.map(id => byId.get(id)).filter((h): h is Hotspot => Boolean(h));
  const visitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const find of finds) counts.set(find.hotspotId, (counts.get(find.hotspotId) ?? 0) + 1);
    return counts;
  }, [finds]);
  const ready = hotspots.filter(h => rankingScore(assessments[h.id]) != null).length;
  return <FlatList style={styles.list} data={rows} keyExtractor={h => h.id}
    keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
    ListHeaderComponent={<View style={styles.header}>
      <Text style={styles.label}>POGOJI NA RASTIŠČIH</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
        {(Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]).map(targetProfile => <Choice key={targetProfile}
          label={MUSHROOM_WEATHER_PROFILES[targetProfile].label} selected={context.targetProfile === targetProfile}
          onPress={() => onContext({ ...context, targetProfile })} />)}
      </ScrollView>
      <View style={styles.choices}><Choice label="Danes" selected={context.dayMode === 'today'} onPress={() => onContext({ ...context, dayMode: 'today' })} />
        <Choice label="Jutri" selected={context.dayMode === 'tomorrow'} onPress={() => onContext({ ...context, dayMode: 'tomorrow' })} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
        <Choice label="Zadnja sprememba" selected={sort === 'recent'} onPress={() => setSort('recent')} />
        <Choice label="Najboljši pogoji" selected={sort === 'conditions'} onPress={() => setSort('conditions')} />
        <Choice label="Ime" selected={sort === 'name'} onPress={() => setSort('name')} />
      </ScrollView>
      <Text style={commonStyles.muted}>{ready} z oceno · {hotspots.length - ready} brez ocene</Text>
      {loading ? <View style={styles.choices}><ActivityIndicator size="small" color={colors.primary} /><Text style={commonStyles.muted}>Dopolnjujem pogoje …</Text></View> : null}
      {!loading && !ready ? <Text style={commonStyles.muted}>Trenutno ni mogoče izračunati pogojev za shranjena rastišča.</Text> : null}
      {!loading && (error || ready < hotspots.length) ? <Choice label="Poskusi znova" onPress={retry} /> : null}
      <Text style={styles.caveat}>Razvrstitev primerja vremenske razmere, ne zagotavlja prisotnosti gob.</Text>
    </View>}
    renderItem={({ item }) => {
      const assessment = assessments[item.id], score = rankingScore(assessment);
      return <Pressable accessibilityRole="button" accessibilityLabel={`Odpri rastišče ${item.title || 'brez naslova'}`}
        onPress={() => navigation.navigate('HotspotDetail', rankingDetailParams(item.id, context))}>
        <Card><View style={styles.row}><View style={styles.grow}>
          <Text style={commonStyles.heading}>{item.title || 'Rastišče brez naslova'}</Text>
          <Text style={score != null ? styles.score : commonStyles.muted}>{score != null ? `${score} / 100 · ${assessment!.classLabel}` : loading ? 'Pridobivam pogoje …' : 'Ni ocene'}</Text>
          {score != null && assessment?.summary.stale ? <Text style={commonStyles.muted}>Starejša ocena iz predpomnilnika</Text> : null}
          <Text style={commonStyles.muted}>{item.latitude.toFixed(4)}, {item.longitude.toFixed(4)} · {visitCounts.get(item.id) ?? 0} obiskov</Text>
        </View><StatusPill state={item.syncState} /></View></Card>
      </Pressable>;
    }} />;
}
function Choice({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(selected) }}
    onPress={onPress} style={[styles.choice, selected && styles.selected]}>
    <Text style={[styles.choiceText, selected && styles.selectedText]}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({ list: { flex: 1, minHeight: 0 }, content: { gap: spacing.md, paddingBottom: spacing.sm },
  header: { gap: spacing.sm }, choices: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700' }, caveat: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  choice: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.round, paddingHorizontal: spacing.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, selected: { backgroundColor: colors.primary },
  choiceText: { color: colors.text, fontSize: 13, fontWeight: '600' }, selectedText: { color: colors.white },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }, grow: { flex: 1, gap: spacing.xs },
  score: { color: colors.primary, fontSize: 16, fontWeight: '600' } });
