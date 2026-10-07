import { memo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import type { MushroomWeatherProfileId } from '../domain/types';
import type { ConditionsTargetContext, HotspotSortMode } from '../domain/hotspotRanking';
import { colors, radii, spacing } from '../theme';

const SORT_OPTIONS: Array<{ id: HotspotSortMode; label: string }> = [
  { id: 'recent', label: 'Zadnja sprememba' },
  { id: 'conditions', label: 'Najboljši pogoji' },
  { id: 'name', label: 'Ime' },
];

/** Presentation-only menu state stays below the grouped conditions/evaluation hook. */
export const HotspotRankingControls = memo(function HotspotRankingControls({ context, onContext, sort, onSort }: {
  context: ConditionsTargetContext; onContext: (value: ConditionsTargetContext) => void;
  sort: HotspotSortMode; onSort: (value: HotspotSortMode) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const label = SORT_OPTIONS.find(option => option.id === sort)!.label;
  return <View style={styles.controls}>
    <View style={styles.heading}>
      <Text style={styles.label}>POGOJI NA RASTIŠČIH</Text>
      <Ionicons name="swap-horizontal-outline" size={15} color={colors.muted} accessible={false} />
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={true} contentContainerStyle={styles.species}
      accessibilityLabel="Profil pogojev" accessibilityHint="Za več profilov podrsajte levo ali desno.">
      {(Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]).map(targetProfile =>
        <Pressable key={targetProfile} accessibilityRole="button" accessibilityState={{ selected: context.targetProfile === targetProfile }}
          onPress={() => onContext({ ...context, targetProfile })}
          style={[styles.chip, context.targetProfile === targetProfile && styles.chipSelected]}>
          <Text style={[styles.text, context.targetProfile === targetProfile && styles.chipSelectedText]}>{MUSHROOM_WEATHER_PROFILES[targetProfile].label}</Text>
        </Pressable>)}
    </ScrollView>
    <View style={styles.controlsRow}>
      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel="Dan ocene">
        {(['today', 'tomorrow'] as const).map(dayMode => <Pressable key={dayMode} accessibilityRole="radio"
          accessibilityState={{ checked: context.dayMode === dayMode }} onPress={() => onContext({ ...context, dayMode })}
          style={[styles.segment, context.dayMode === dayMode && styles.segmentSelected]}>
          <Text style={[styles.text, context.dayMode === dayMode && styles.segmentSelectedText]}>{dayMode === 'today' ? 'Danes' : 'Jutri'}</Text>
        </Pressable>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Razvrsti: ${label}`} accessibilityState={{ expanded: menuOpen }}
        accessibilityHint="Odpre možnosti razvrščanja." onPress={() => setMenuOpen(true)} style={styles.sortControl}>
        <Text style={[styles.text, styles.sortText]}>{label}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.primary} accessible={false} />
      </Pressable>
    </View>
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
      <SafeAreaView style={styles.menuScreen}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Zapri možnosti razvrščanja" onPress={() => setMenuOpen(false)} />
        <View style={styles.menu} accessibilityViewIsModal>
          <Text style={styles.menuTitle}>Razvrsti rastišča</Text>
          {SORT_OPTIONS.map(option => <Pressable key={option.id} accessibilityRole="radio"
            accessibilityState={{ checked: sort === option.id }} onPress={() => { setMenuOpen(false); onSort(option.id); }}
            style={[styles.menuOption, sort === option.id && styles.menuSelected]}>
            <Text style={[styles.text, styles.sortText]}>{option.label}</Text>
            {sort === option.id ? <Ionicons name="checkmark" size={20} color={colors.primary} accessible={false} /> : null}
          </Pressable>)}
          <Pressable accessibilityRole="button" onPress={() => setMenuOpen(false)} style={styles.menuOption}><Text style={styles.text}>Prekliči</Text></Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
});

const styles = StyleSheet.create({
  controls: { gap: spacing.xs }, heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  species: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.xs },
  text: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chip: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.round,
    paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { backgroundColor: colors.primary }, chipSelectedText: { color: colors.white },
  controlsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  segmented: { flexDirection: 'row', flexBasis: 136, flexGrow: 0, flexShrink: 0, borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSoft, overflow: 'hidden' },
  segment: { flex: 1, minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center', alignItems: 'center' },
  segmentSelected: { backgroundColor: colors.surface }, segmentSelectedText: { color: colors.primary, fontWeight: '800' },
  sortControl: { flexBasis: 156, flexGrow: 1, flexShrink: 1, minWidth: 156, minHeight: 44,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sortText: { flex: 1, flexShrink: 1 },
  menuScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.overlay },
  menu: { width: '100%', maxWidth: 360, borderRadius: radii.md, padding: spacing.sm, backgroundColor: colors.surface },
  menuTitle: { fontSize: 16, fontWeight: '700', color: colors.primary, padding: spacing.sm },
  menuOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radii.sm },
  menuSelected: { backgroundColor: colors.surfaceSoft },
});
