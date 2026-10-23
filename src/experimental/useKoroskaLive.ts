import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { civilDailyPeriod } from '../domain/soilSampling';
import { weatherLocalDate } from '../domain/weatherSeries';
import type { ShadowArtifact } from './koroskaShadowData';
import { liveIsStale, peekLiveRegional, refreshLiveRegional, type LiveRegionalSnapshot } from './koroskaLive';

/** Lifecycle updates freshness labels only. Acquisition exists exclusively in the returned refresh action. */
export function useKoroskaLive(db: SQLiteDatabase, artifact: ShadowArtifact | undefined, enabled: boolean) {
  const [loaded, setLoaded] = useState<{ snapshot: LiveRegionalSnapshot; cached: boolean; db: SQLiteDatabase; artifact: ShadowArtifact }>();
  const [loading, setLoading] = useState(false), [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const generation = useRef(0), current = useRef({ enabled, artifact, db }); current.current = { enabled, artifact, db };
  useEffect(() => {
    generation.current++; setLoading(false); setLoaded(undefined); setError(undefined);
    return () => { generation.current++; };
  }, [enabled, artifact, db]);
  const local = loaded?.db === db && loaded.artifact === artifact ? loaded : undefined;
  const stored = artifact ? peekLiveRegional(db) : undefined;
  const compatible = stored?.geometryFingerprint === artifact?.geometryFingerprint && stored?.modelFingerprint === artifact?.modelFingerprint ? stored : undefined;
  const snapshot = enabled && !loading && !error ? local?.snapshot ?? compatible : undefined;
  const stale = snapshot ? liveIsStale(snapshot) : false;
  useEffect(() => {
    if (!enabled) return;
    const update = () => setTick(v => v + 1);
    const midnight = Date.parse(civilDailyPeriod(weatherLocalDate()).endUtc!);
    const deadline = Math.min(midnight, snapshot && snapshot.expiresAt > Date.now() ? snapshot.expiresAt : Infinity);
    const timer = setTimeout(update, Math.max(1, deadline - Date.now()));
    const listener = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    return () => { clearTimeout(timer); listener.remove(); };
  }, [enabled, snapshot, tick]);
  const refresh = useCallback(async () => {
    if (!current.current.enabled || !current.current.artifact) return;
    const context = current.current, token = ++generation.current;
    setLoading(true); setError(undefined);
    try {
      const result = await refreshLiveRegional(context.db, context.artifact!);
      if (generation.current === token && current.current.enabled && current.current.artifact === context.artifact && current.current.db === context.db) {
        if (result.snapshot.baseLocalDate !== weatherLocalDate()) setError('Lokalni datum se je spremenil; ročno pridobi novo okno.');
        else setLoaded({ ...result, db: context.db, artifact: context.artifact! });
      }
    } catch (cause) {
      if (generation.current === token && current.current.enabled && current.current.artifact === context.artifact && current.current.db === context.db) setError(cause instanceof Error ? cause.message : 'Napovedi ni mogoče pridobiti.');
    } finally { if (generation.current === token && current.current.enabled) setLoading(false); }
  }, []);
  const message = loading ? 'Pridobivam 11 javnih vremenskih lokacij …' : error ? 'Napoved ni objavljena — napaka pri virih.'
    : !snapshot ? 'Še ni pridobljeno. Potreben je ročni zajem.' : !snapshot.publicationAllowed ? 'Nepopolni vhodi — regionalnih številčnih ocen ne objavimo.'
    : stale ? 'Starejša predpomnjena napoved — ni sveža.' : local?.cached !== false ? 'Veljavna predpomnjena napoved.' : 'Validiran razvojni zajem.';
  return { snapshot, knownDates: compatible?.dates, loading, error, stale, message, refresh };
}
