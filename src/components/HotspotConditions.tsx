import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AppButton, Card, Chip, commonStyles } from './ui';
import type { Hotspot, MushroomWeatherProfileId } from '../domain/types';
import type { HeatmapAreaAssessment, HeatmapTargetDay } from '../domain/heatmap/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';
import { cardFactors, cardHabitat } from '../domain/heatmap/cardPresentation';
import { useLocationConditions } from '../services/heatmap/useLocationConditions';
import { colors, spacing } from '../theme';

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

export function HotspotConditionsPopup({ hotspot, profile, day }: { hotspot: Hotspot; profile: MushroomWeatherProfileId; day: HeatmapTargetDay }) {
  const { assessments, loading } = useLocationConditions([hotspot], profile, day);
  return <View style={styles.summary}><Text style={commonStyles.muted}>{MUSHROOM_WEATHER_PROFILES[profile].label} · {day === 'today' ? 'Danes' : 'Jutri'}</Text>
    <LocationConditionsSummary assessment={assessments[hotspot.id]} loading={loading} />
  </View>;
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summary: { gap: spacing.xs }, score: { fontSize: 34, fontWeight: '700', color: colors.primary },
  denominator: { fontSize: 18, color: colors.muted }, factor: { flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }, status: { color: colors.primary, fontSize: 13, fontWeight: '600', flexShrink: 1 } });
