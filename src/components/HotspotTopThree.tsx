import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Hotspot } from '../domain/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import type { ConditionsTargetContext } from '../domain/hotspotRanking';
import { topThreeHotspots } from '../domain/hotspotTopThree';
import { useLocationConditions } from '../services/heatmap/useLocationConditions';
import { colors, radii, spacing } from '../theme';

/** Mounted after first use; closing never restarts the grouped weather acquisition.
 * Progress belongs to this child, not MapScreen's regional/native-source render path. */
export function HotspotTopThree({ hotspots, context, enabled, visible, maxHeight, onClose, onSelect }: {
  hotspots: Hotspot[]; context: ConditionsTargetContext; enabled: boolean; visible: boolean;
  maxHeight: number; onClose: () => void; onSelect: (hotspot: Hotspot) => void;
}) {
  const { assessments, complete, error, retry } = useLocationConditions(hotspots, context.targetProfile, context.dayMode, enabled, 250);
  if (!visible) return null;
  const rows = topThreeHotspots(hotspots, assessments, complete);
  return <View style={[styles.panel, { maxHeight }]}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><View style={styles.grow}>
        <Text style={styles.title}>Top 3 po modelni oceni</Text>
        <Text style={styles.secondary}>{MUSHROOM_WEATHER_PROFILES[context.targetProfile].label} · {context.dayMode === 'today' ? 'Danes' : 'Jutri'}</Text>
      </View><Pressable accessibilityRole="button" accessibilityLabel="Zapri Top 3" onPress={onClose} style={styles.close}>
        <Ionicons name="close" size={22} color={colors.primary} /></Pressable></View>
      {!hotspots.length ? <Text style={styles.secondary}>Za prikaz najboljših pogojev najprej shrani rastišče.</Text>
        : !complete ? <View style={styles.loading}><ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.secondary, styles.grow]}>Izračunavam pogoje za moja rastišča ...</Text></View>
        : rows.length ? rows.map((hotspot, index) => <Pressable key={hotspot.id} accessibilityRole="button"
          accessibilityLabel={`Prikaži ${hotspot.title || 'rastišče'} na zemljevidu`}
          onPress={() => onSelect(hotspot)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Text style={styles.rank}>#{index + 1}</Text><View style={styles.grow}>
            <Text numberOfLines={2} ellipsizeMode="tail" style={styles.name}>{hotspot.title || 'Rastišče brez naslova'}</Text>
            <Text style={styles.secondary}>{assessments[hotspot.id]!.classLabel}</Text>
          </View><Text style={styles.score}>{assessments[hotspot.id]!.score}/100</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>) : <Text style={styles.secondary}>Trenutno ni mogoče izračunati pogojev za shranjena rastišča.</Text>}
      {complete && hotspots.length > rows.length && (error || !rows.length) ? <Pressable accessibilityRole="button" onPress={retry} style={styles.retry}>
        <Text style={styles.name}>Poskusi znova</Text></Pressable> : null}
      <Text style={styles.caveat}>Ocena ne zagotavlja najdbe.</Text>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({ panel: { borderRadius: radii.lg, backgroundColor: colors.surface,
  borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }, scroll: { flexShrink: 1, minHeight: 0 },
  content: { padding: spacing.sm }, header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  grow: { flex: 1, minWidth: 0 }, title: { color: colors.primary, fontSize: 17, lineHeight: 20, fontWeight: '700' },
  secondary: { color: colors.muted, fontSize: 13, lineHeight: 17 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.round, backgroundColor: colors.surfaceSoft },
  loading: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  row: { minHeight: 44, paddingVertical: spacing.xs, gap: spacing.sm, flexDirection: 'row', alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed: { backgroundColor: colors.surfaceSoft },
  name: { fontSize: 15, lineHeight: 18, fontWeight: '600', color: colors.text }, rank: { color: colors.muted, fontSize: 13 },
  score: { fontSize: 15, fontWeight: '700', color: colors.primary, flexShrink: 0 }, caveat: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  retry: { minHeight: 44, justifyContent: 'center' } });
