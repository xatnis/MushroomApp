import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import type { Hotspot, MushroomWeatherProfileId } from '../domain/types';
import type { HeatmapTargetDay } from '../domain/heatmap/types';
import type { Bounds } from '../domain/heatmap/spatial';
import { useLocationConditions } from '../services/heatmap/useLocationConditions';
import { colors } from '../theme';

/** Native view annotations stay above fills; their weather updates cannot rebuild Map's sources. */
export function HotspotConditionsMarkers({ hotspots, selectedId, enabled, profile, day, bounds, onSelect }: {
  hotspots: Hotspot[]; selectedId?: string; enabled: boolean; profile: MushroomWeatherProfileId;
  day: HeatmapTargetDay; bounds?: Bounds; onSelect: (hotspot: Hotspot) => void;
}) {
  const visible = useMemo(() => hotspots.filter(h => h.id === selectedId || (bounds && h.longitude >= bounds[0]
    && h.longitude <= bounds[2] && h.latitude >= bounds[1] && h.latitude <= bounds[3])), [hotspots, selectedId, bounds]);
  const { assessments } = useLocationConditions(visible, profile, day, enabled, 250);
  return <>{hotspots.map(hotspot => {
    const score = enabled ? assessments[hotspot.id]?.score : undefined;
    return <Marker key={hotspot.id} id={hotspot.id} lngLat={[hotspot.longitude, hotspot.latitude]} anchor="bottom" onPress={event => {
      event.stopPropagation(); onSelect(hotspot);
    }}><View style={styles.frame}><View style={[styles.shell, selectedId === hotspot.id && styles.selected]}>
      <Image source={require('../../assets/mushroom-icon.png')} style={styles.icon} />
      {score != null ? <View style={styles.badge}><Text accessibilityLabel={`Vremenske razmere ${score} od 100`} style={styles.score}>{score}</Text></View> : null}
    </View></View></Marker>;
  })}</>;
}
const styles = StyleSheet.create({ frame: { width: 54, height: 52, paddingLeft: 4, paddingTop: 4 },
  shell: { width: 46, height: 46, borderRadius: 23, borderWidth: 3,
    borderColor: colors.white, backgroundColor: colors.white, elevation: 4 },
  selected: { borderColor: colors.secondary, transform: [{ scale: 1.12 }] },
  icon: { width: 40, height: 40, borderRadius: 20 }, badge: { position: 'absolute', right: -3, top: -3, minWidth: 24,
    borderRadius: 12, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: colors.surface,
    borderColor: colors.primary, borderWidth: 1 }, score: { color: colors.primary, fontSize: 12, fontWeight: '700' } });
