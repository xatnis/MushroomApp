import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useIsFocused } from '@react-navigation/native';
import { conditionsForLocation, mapConditionsLocation, validConditionsLocation, type ConditionsLocation } from '../../domain/locationConditions';
import type { MushroomWeatherProfileId } from '../../domain/types';
import type { HeatmapTargetDay } from '../../domain/heatmap/types';
import { cachedPointSnapshot, loadPointSnapshots, subscribePointConditions } from '../pointConditions';
import { scheduleSettledHeatmapLoad } from './pilotHeatmap';
import type { SevenDaySnapshot } from '../../domain/sevenDayConditions';
import { usePointLocalDate } from '../usePointLocalDate';

/** Canonical exact-coordinate point cache. Regional sources/LOD do not subscribe to these updates. */
export function useLocationConditions(locations: ConditionsLocation[], profile: MushroomWeatherProfileId,
  day: HeatmapTargetDay, enabled = true, debounceMs = 0) {
  const db = useSQLiteContext();
  const focused = useIsFocused();
  const active = enabled && focused;
  const key = JSON.stringify(locations.map(p => [p.id, p.latitude, p.longitude]));
  const mappings = useMemo(() => locations.filter(validConditionsLocation).map(mapConditionsLocation), [key]);
  const [snapshots, setSnapshots] = useState<Record<string, SevenDaySnapshot | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [attempt, retry] = useState(0);
  const [foreground, refreshForeground] = useState(0);
  const [error, setError] = useState<string>();
  const baseDate = usePointLocalDate();
  const loadKey = JSON.stringify([key, baseDate, active, attempt, foreground, debounceMs]);
  const [settledKey, setSettledKey] = useState<string>();
  const generation = useRef(loadKey); generation.current = loadKey;
  const read = () => Object.fromEntries(mappings.map(m => [m.id, cachedPointSnapshot(db, m, baseDate)]));
  useEffect(() => {
    if (!active || !mappings.length) return;
    const update = () => {
      const next = read();
      setSnapshots(previous => mappings.every(m => previous[m.id] === next[m.id]) ? previous : next);
    };
    update();
    return subscribePointConditions(db, update);
  }, [db, key, baseDate, active]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') refreshForeground(value => value + 1);
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!active || !mappings.length) { setLoading(false); setSettledKey(undefined); return; }
    let current = true;
    setLoading(true); setError(undefined);
    const cancel = scheduleSettledHeatmapLoad(() => {
      void loadPointSnapshots(db, mappings, baseDate)
        .then(() => { if (current && generation.current === loadKey) {
          const next = read(); setSnapshots(next);
          if (Object.values(next).some(snapshot => snapshot?.today.errors.forecast || snapshot?.today.errors.historical)) setError('Ocene trenutno ni mogoče izračunati.');
        } })
        .catch(() => { if (current && generation.current === loadKey) setError('Ocene trenutno ni mogoče izračunati.'); })
        .finally(() => {
          if (current && generation.current === loadKey) {
            setSettledKey(loadKey);
            setLoading(false);
          }
        });
    }, debounceMs);
    return () => { current = false; cancel(); };
    // Profile and target day intentionally absent: one snapshot contains all profiles and both dates.
  }, [db, key, baseDate, active, attempt, foreground, debounceMs]);
  const assessments = useMemo(() => Object.fromEntries(enabled ? mappings.map(m =>
    [m.id, conditionsForLocation(m, snapshots[m.id], profile, day, baseDate)]) : []), [mappings, snapshots, profile, day, baseDate, enabled]);
  // False on the FIRST render of a new location/date/load generation, even before
  // the effect sets loading. Species/day use the same snapshot and don't reset it.
  const complete = !mappings.length || (active && settledKey === loadKey);
  return { assessments, mappings, loading, complete, error, retry: () => retry(value => value + 1) };
}
