import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton, Card, Chip, StatusPill, commonStyles } from './ui';
import type { Hotspot, MushroomWeatherProfileId } from '../domain/types';
import type { HeatmapAreaAssessment, HeatmapTargetDay } from '../domain/heatmap/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { cardFactors, cardHabitat } from '../domain/heatmap/cardPresentation';
import { useLocationConditions } from '../services/heatmap/useLocationConditions';
import { colors, radii, spacing } from '../theme';

export function LocationConditionsSummary({ assessment, loading }: { assessment?: HeatmapAreaAssessment; loading: boolean }) {
  if (assessment?.score == null) return <View style={styles.row}>
    {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
    <Text style={commonStyles.muted}>{loading ? 'Pridobivam pogoje ...' : 'Ocene trenutno ni mogoče izračunati.'}</Text>
  </View>;
  return <View style={styles.summary}><Text style={styles.score}>{assessment.score} <Text style={styles.denominator}>/ 100</Text></Text>
    <Text style={commonStyles.heading}>{assessment.classLabel}</Text>
    {assessment.summary.stale || Date.now() - Date.parse(assessment.fetchedAt) > 30 * 60 * 1000
      ? <Text style={commonStyles.muted}>Prikazana je starejša ocena iz predpomnilnika.</Text> : null}
  </View>;
}

export function HotspotConditionsCard({ hotspot, profile, day, onProfile, onDay, onOpenMap, fallbackNames }: {
  hotspot: Hotspot; profile: MushroomWeatherProfileId; day: HeatmapTargetDay;
  onProfile: (profile: MushroomWeatherProfileId) => void; onDay: (day: HeatmapTargetDay) => void;
  onOpenMap: () => void; fallbackNames?: string;
}) {
  const conditions = useLocationConditions([hotspot], profile, day);
  const assessment = conditions.assessments[hotspot.id];
  return <Card>
    <Text style={commonStyles.heading}>Pogoji na rastišču</Text>
    <View style={commonStyles.wrap}>{(Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]).map(id =>
      <Chip key={id} label={MUSHROOM_WEATHER_PROFILES[id].label} selected={profile === id} onPress={() => onProfile(id)} />)}</View>
    {profile === 'generic' && fallbackNames ? <Text style={commonStyles.muted}>Za zabeležene vrste ({fallbackNames}) še ni ločenega modela; prikazana je splošna ocena.</Text> : null}
    <View style={styles.row}><Chip label="Danes" selected={day === 'today'} onPress={() => onDay('today')} />
      <Chip label="Jutri" selected={day === 'tomorrow'} onPress={() => onDay('tomorrow')} /></View>
    <Text style={commonStyles.muted}>{MUSHROOM_WEATHER_PROFILES[profile].label} · {day === 'today' ? 'Danes' : 'Jutri'}</Text>
    <LocationConditionsSummary assessment={assessment} loading={conditions.loading} />
    {assessment?.score != null ? <View>{cardFactors(assessment).map(f => <View key={f.key} style={styles.factor}>
      <Text style={commonStyles.body}>{f.label}</Text><Text style={styles.status}>{f.status}</Text>
    </View>)}<Text style={commonStyles.muted}>Habitat: {cardHabitat(assessment).title}</Text></View> : null}
    {!conditions.loading && assessment?.score == null ? <AppButton title="Poskusi znova" variant="secondary" onPress={conditions.retry} /> : null}
    <AppButton title="Odpri pogoje na zemljevidu" variant="secondary" onPress={onOpenMap} />
    <Text style={commonStyles.muted}>Vremenska ocena ne zagotavlja prisotnosti gob. Vreme: Open-Meteo. Habitat: ESA WorldCover 2021 in ZGS, kjer je na voljo.</Text>
  </Card>;
}

export function HotspotConditionsPopup({ hotspot, profile, day, compact = false }: { hotspot: Hotspot; profile: MushroomWeatherProfileId; day: HeatmapTargetDay; compact?: boolean }) {
  const { assessments, loading } = useLocationConditions([hotspot], profile, day);
  const assessment = assessments[hotspot.id];
  if (compact) return <View style={styles.summary}>
    <Text style={styles.mapContext}>{MUSHROOM_WEATHER_PROFILES[profile].label} · {day === 'today' ? 'Danes' : 'Jutri'}</Text>
    <Text style={assessment?.score != null ? styles.mapScore : styles.mapContext}>{assessment?.score != null
      ? `${assessment.score}/100 · ${assessment.classLabel}` : loading ? 'Pridobivam pogoje ...' : 'Ocene trenutno ni mogoče izračunati.'}</Text>
    {assessment?.score != null && (assessment.summary.stale || Date.now() - Date.parse(assessment.fetchedAt) > 30 * 60 * 1000)
      ? <Text style={styles.mapContext}>Starejša ocena iz predpomnilnika</Text> : null}
  </View>;
  return <View style={styles.summary}><Text style={commonStyles.muted}>{MUSHROOM_WEATHER_PROFILES[profile].label} · {day === 'today' ? 'Danes' : 'Jutri'}</Text>
    <LocationConditionsSummary assessment={assessments[hotspot.id]} loading={loading} />
  </View>;
}

/** Same point evaluator; map presentation only. Close and open are sibling targets. */
export function HotspotMapCard({ hotspot, profile, day, conditionsEnabled, visits, onOpen, onClose, onBackToTopThree }: {
  hotspot: Hotspot; profile: MushroomWeatherProfileId; day: HeatmapTargetDay; conditionsEnabled: boolean;
  visits: number; onOpen: () => void; onClose: () => void; onBackToTopThree?: () => void;
}) {
  const close = <Pressable accessibilityRole="button" accessibilityLabel="Zapri kartico rastišča" onPress={onClose}
    style={({ pressed }) => [styles.mapClose, pressed && styles.mapPressed]}><Ionicons name="close" size={22} color={colors.primary} /></Pressable>;
  return <View style={onBackToTopThree ? [styles.mapCard, styles.mapTopThreeCard] : styles.mapCard}>
    {onBackToTopThree ? <View style={styles.mapBackRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Nazaj na Top 3" onPress={onBackToTopThree}
        style={({ pressed }) => [styles.mapBack, pressed && styles.mapPressed]}>
        <Ionicons name="arrow-back" size={18} color={colors.primary} /><Text style={styles.mapBackLabel}>Nazaj na Top 3</Text>
      </Pressable>{close}</View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={`Odpri rastišče ${hotspot.title || 'brez naslova'}`}
      onPress={onOpen} style={({ pressed }) => [styles.mapOpen, onBackToTopThree && styles.mapTopThreeOpen, pressed && styles.mapPressed]}>
      <View style={styles.mapBody}><Text numberOfLines={2} ellipsizeMode="tail" style={styles.mapTitle}>{hotspot.title || 'Rastišče brez naslova'}</Text>
        {conditionsEnabled ? <HotspotConditionsPopup hotspot={hotspot} profile={profile} day={day} compact />
          : <Text style={styles.mapContext}>{visits} obiskov</Text>}
        <StatusPill state={hotspot.syncState} />
      </View><Ionicons name="chevron-forward" size={22} color={colors.primary} />
    </Pressable>
    {!onBackToTopThree ? close : null}
  </View>;
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mapCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border },
  mapOpen: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  mapTopThreeCard: { flexDirection: 'column', alignItems: 'stretch' },
  mapTopThreeOpen: { flex: 0 },
  mapBackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  mapBack: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  mapBackLabel: { color: colors.primary, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  mapBody: { flex: 1, minWidth: 0, gap: spacing.xs }, mapTitle: { fontSize: 18, lineHeight: 22, fontWeight: '700', color: colors.text },
  mapContext: { fontSize: 13, lineHeight: 18, color: colors.muted }, mapScore: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.primary },
  mapClose: { minWidth: 44, minHeight: 44, borderRadius: radii.round, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft },
  mapPressed: { opacity: .7 },
  summary: { gap: spacing.xs }, score: { fontSize: 34, fontWeight: '700', color: colors.primary },
  denominator: { fontSize: 18, color: colors.muted }, factor: { flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }, status: { color: colors.primary, fontSize: 13, fontWeight: '600', flexShrink: 1 } });
