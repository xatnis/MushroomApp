import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useIsFocused } from '@react-navigation/native';
import { conditionsForLocation, mapConditionsLocation, validConditionsLocation, type ConditionsLocation } from '../../domain/locationConditions';
import type { MushroomWeatherProfileId } from '../../domain/types';
import type { HeatmapTargetDay } from '../../domain/heatmap/types';
import { localDateFor } from '../../domain/heatmap/assessment';
import { cachedHeatmapBundle, loadHeatmapPilot, scheduleSettledHeatmapLoad, subscribeHeatmapConditions, type HeatmapPilotBundle } from './pilotHeatmap';

/** One grouped request for missing points, shared with the map; selection only evaluates cached inputs. */
export function useLocationConditions(locations: ConditionsLocation[], profile: MushroomWeatherProfileId,
  day: HeatmapTargetDay, enabled = true, debounceMs = 0) {
  const db = useSQLiteContext();
  const focused = useIsFocused();
  const active = enabled && focused;
  const key = JSON.stringify(locations.map(p => [p.id, p.latitude, p.longitude]));
  const mappings = useMemo(() => locations.filter(validConditionsLocation).map(mapConditionsLocation), [key]);
  const [bundle, setBundle] = useState<HeatmapPilotBundle | undefined>(() => cachedHeatmapBundle(db));
  const [loading, setLoading] = useState(false);
  const [attempt, retry] = useState(0);
  const [foreground, refreshForeground] = useState(0);
  const [error, setError] = useState<string>();
  const baseDate = localDateFor();
  const previous = useRef<HeatmapPilotBundle | undefined>(bundle);
  useEffect(() => {
    if (!active || !mappings.length) return;
    const update = () => {
      const next = cachedHeatmapBundle(db);
      // Other viewport batches must not rerender cards/markers with unchanged inputs.
      if (next?.baseLocalDate === previous.current?.baseLocalDate && mappings.every(m =>
        next?.weather.cells[m.weatherPoint.id] === previous.current?.weather.cells[m.weatherPoint.id])) return;
      previous.current = next; setBundle(next);
    };
    update();
    return subscribeHeatmapConditions(db, update);
  }, [db, key, active]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') refreshForeground(value => value + 1);
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!active || !mappings.length) { setLoading(false); return; }
    let current = true;
    const controller = new AbortController();
    setLoading(true); setError(undefined);
    const cancel = scheduleSettledHeatmapLoad(() => {
      const points = [...new Map(mappings.map(m => [m.weatherPoint.id, m.weatherPoint])).values()];
      const started = Date.now();
      void loadHeatmapPilot(db, { pointIds: points.map(p => p.id), pointDefinitions: points, signal: controller.signal })
        .catch(() => { if (current) setError('Ocene trenutno ni mogoče izračunati.'); })
        .finally(() => {
          if (current) {
            setLoading(false);
            if (__DEV__) console.info('[location conditions]', { locations: mappings.length,
              weatherPoints: points.length, durationMs: Date.now() - started, sharedCacheAndDedupe: true });
          }
        });
    }, debounceMs);
    return () => { current = false; cancel(); controller.abort(); };
    // Profile and target day intentionally absent: one snapshot contains all profiles and both dates.
  }, [db, key, baseDate, active, attempt, foreground, debounceMs]);
  const assessments = useMemo(() => Object.fromEntries(enabled ? mappings.map(m =>
    [m.id, conditionsForLocation(m, bundle, profile, day, baseDate)]) : []), [mappings, bundle, profile, day, baseDate, enabled]);
  return { assessments, mappings, loading, error, retry: () => retry(value => value + 1) };
}
