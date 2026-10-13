import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MushroomWeatherProfileId, MushroomWeatherSummary } from '../domain/types';
import { evaluateSevenDayConditions, type SevenDaySnapshot } from '../domain/sevenDayConditions';
import { weatherLocalDate, WEATHER_TIMEZONE } from '../domain/weatherSeries';
import { shiftLocalDate } from './weather';
import { loadSevenDaySnapshot } from './sevenDayConditions';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';

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
  const key = `${location.latitude}:${location.longitude}:${today}:${retry}`;
  const current = useRef(key); current.current = key;
  const onLoaded = useRef(onSnapshot); onLoaded.current = onSnapshot;
  useEffect(() => {
    const refreshDay = () => setToday(weatherLocalDate());
    const timer = setTimeout(refreshDay, Math.max(1, nextWeatherMidnight() - Date.now()));
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refreshDay(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [today]);
  useEffect(() => {
    let active = true;
    void loadSevenDaySnapshot(db, location, today, { seedUpdatedAt: seed?.updatedAt }).then(snapshot => {
      if (!active || current.current !== key) return;
      setLoaded({ key, snapshot }); setFailure(undefined);
      // Keep Razmere's Today on this same canonical weather snapshot, never a different forecast vintage.
      if (!snapshot.blockers.length) onLoaded.current(snapshot.today);
    }).catch(cause => { if (active && current.current === key) setFailure({ key, message: cause instanceof Error ? cause.message : 'Napovedi trenutno ni mogoče pridobiti.' }); });
    return () => { active = false; };
    // Profile and day selection are local calculations, not acquisition dependencies.
  }, [db, key]);
  const snapshot = loaded?.key === key ? loaded.snapshot : undefined;
  const allProfiles = useMemo(() => snapshot ? Object.fromEntries(Object.keys(MUSHROOM_WEATHER_PROFILES).map(id => [id, evaluateSevenDayConditions(snapshot, id as MushroomWeatherProfileId)])) : undefined, [snapshot]);
  return { today, snapshot, results: allProfiles?.[profile], loading: !snapshot && failure?.key !== key,
    error: failure?.key === key ? failure.message : undefined, retry: () => setRetry(value => value + 1) };
}
