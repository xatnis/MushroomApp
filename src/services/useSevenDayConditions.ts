import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId, MushroomWeatherSummary } from '../domain/types';
import { CANONICAL_POINT_POLICY, type SevenDaySnapshot } from '../domain/sevenDayConditions';
import { cachedPointSnapshot, pointResults, pointSnapshotForDisplay, subscribePointConditions } from './pointConditions';
import { markPointTiming, pointTimingEnabled } from './pointTiming';
import { weatherLocalDate, WEATHER_TIMEZONE } from '../domain/weatherSeries';
import { shiftLocalDate } from './weather';
import { loadSevenDaySnapshot } from './sevenDayConditions';

/** Calendar deadline, not an arbitrary loading delay. Recalculate offsets at the actual local midnight (DST safe). */
export function nextWeatherMidnight(now = new Date()): number {
  const utcMidnight = Date.parse(shiftLocalDate(weatherLocalDate(now), 1) + 'T00:00:00Z');
  let candidate = utcMidnight;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: WEATHER_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 2; i++) {
    const parts = formatter.formatToParts(candidate), read = (key: string) => Number(parts.find(p => p.type === key)!.value);
    const local = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
    candidate = utcMidnight - (local - candidate);
  }
  return candidate;
}

export function useSevenDayConditions(db: SQLiteDatabase, location: { latitude: number; longitude: number }, profile: MushroomWeatherProfileId,
  seed: MushroomWeatherSummary | undefined, onSnapshot: (summary: MushroomWeatherSummary) => void) {
  const [today, setToday] = useState(() => weatherLocalDate());
  const [loaded, setLoaded] = useState<{ key: string; snapshot: SevenDaySnapshot }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [retry, setRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const key = `${location.latitude}:${location.longitude}:${today}:${retry}`;
  const current = useRef(key); current.current = key;
  const onLoaded = useRef(onSnapshot); onLoaded.current = onSnapshot;
  useEffect(() => {
    const refreshDay = () => setToday(weatherLocalDate());
    const timer = setTimeout(refreshDay, Math.max(1, nextWeatherMidnight() - Date.now()));
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') { refreshDay(); setRefresh(value => value + 1); } });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [today]);
  useEffect(() => {
    const update = () => {
      const snapshot = cachedPointSnapshot(db, location, today);
      if (snapshot && current.current === key) {
        setLoaded(previous => previous?.key === key && previous.snapshot === snapshot ? previous : { key, snapshot });
        if (!snapshot.stale && !snapshot.blockers.length) setFailure(undefined);
      }
    };
    update();
    return subscribePointConditions(db, update);
  }, [db, key]);
  useEffect(() => {
    let active = true;
    void loadSevenDaySnapshot(db, location, today, { seedUpdatedAt: seed?.updatedAt }).then(snapshot => {
      if (!active || current.current !== key) return;
      setLoaded({ key, snapshot }); setFailure(undefined);
      // V1.3 production Today shares this exact point contract. Untagged V1.2 candidates
      // still cannot synchronize the overview and bypass the original protective gate.
      if (!snapshot.blockers.length && (!snapshot.inputContract || snapshot.pointPolicyVersion === CANONICAL_POINT_POLICY)) onLoaded.current(snapshot.today);
    }).catch(cause => { if (active && current.current === key) setFailure({ key, message: cause instanceof Error ? cause.message : 'Napovedi trenutno ni mogoče pridobiti.' }); });
    return () => { active = false; };
    // Profile and day selection are local calculations, not acquisition dependencies.
  }, [db, key, refresh]);
  const snapshot = cachedPointSnapshot(db, location, today) ?? pointSnapshotForDisplay(loaded?.key === key ? loaded.snapshot : undefined);
  useEffect(() => {
    // One deadline for a valid source snapshot; failed/stale refreshes never schedule a retry loop.
    if (!snapshot || snapshot.stale || snapshot.expiresAt <= Date.now()) return;
    const timer = setTimeout(() => setRefresh(value => value + 1), Math.max(1, snapshot.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [snapshot]);
  const selectedResults = useMemo(() => snapshot ? pointResults(snapshot, profile) : undefined, [snapshot, profile]);
  useEffect(() => {
    if (!pointTimingEnabled() || !selectedResults || typeof requestAnimationFrame === 'undefined') return;
    markPointTiming(location, today, 'T8 hook commit');
    const frame = requestAnimationFrame(() => markPointTiming(location, today, 'T9 result frame'));
    return () => cancelAnimationFrame(frame);
  }, [selectedResults]);
  return { today, snapshot, results: selectedResults, loading: !snapshot && failure?.key !== key,
    error: failure?.key === key ? failure.message : undefined, retry: () => setRetry(value => value + 1) };
}
