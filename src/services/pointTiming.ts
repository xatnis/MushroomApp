import { weatherLocalDate } from '../domain/weatherSeries';

type Point = { latitude: number; longitude: number };
type Stage = 'T0 selection' | 'T1 header layout' | 'T2 memory cache' | 'T2 source cache' | 'T3 acquisition start'
  | 'T4 response' | 'T4 sources received' | 'T5 decoded' | 'T5 adapted' | 'T6 inputs built' | 'T7 evaluated' | 'T8 hook commit' | 'T9 result frame';
const traces = new Map<string, { id: number; start: number }>();
let serial = 0;
export const pointTimingEnabled = () => typeof __DEV__ !== 'undefined' && __DEV__;
const identity = (p: Point, date: string) => `${p.latitude}:${p.longitude}:${date}`;
const clock = () => globalThis.performance?.now() ?? Date.now();
/** Local development console only. Never emit coordinates, cache keys, names, IDs or raw payloads. */
export function beginPointTiming(point: Point, date = weatherLocalDate()) {
  if (!pointTimingEnabled()) return;
  traces.set(identity(point, date), { id: ++serial, start: clock() });
  if (traces.size > 128) traces.delete(traces.keys().next().value!);
  markPointTiming(point, date, 'T0 selection');
}
export function markPointTiming(point: Point, date: string, stage: Stage, detail?: 'hit' | 'miss' | 'pending' | 'archive' | 'forecast') {
  if (!pointTimingEnabled()) return;
  const trace = traces.get(identity(point, date));
  if (trace) console.info('[PointTiming]', { request: trace.id, stage, elapsedMs: Math.round((clock() - trace.start) * 100) / 100, ...(detail ? { detail } : {}) });
}
