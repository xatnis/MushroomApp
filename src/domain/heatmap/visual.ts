import { buildHeatmapRenderCollection } from './regional';
import { buildOverviewCollection, type HeatmapLod } from './lod';
import type { MushroomWeatherProfileId } from '../types';
import type { HeatmapHabitatFeature, HeatmapTargetDay, HeatmapWeatherAssessment } from './types';

// Display policy only. Network settlement remains independently debounced at 250 ms.
export const HEATMAP_VISUAL = { viewportDelayMs: 60, weatherCoalesceMs: 80, detailPrewarmZoom: 9.2 } as const;
// Already overlapping before this pass; native zoom MUST NOT override render readiness.
export const HEATMAP_NATIVE_RANGES = { overview: { min: 0, max: 24 }, detail: { min: 0, max: 24 } } as const;
export function scheduleHeatmapVisualUpdate(callback: () => void, delayMs: number = HEATMAP_VISUAL.viewportDelayMs) {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}
export type HeatmapRenderView = ReturnType<typeof buildHeatmapRenderCollection> & { serialized: string };

/** Bounded display cache: effective geometry + only relevant immutable weather objects.
 * Selection, panel state, bounds identity and unrelated progressive batches are NOT keys.
 * Serialize once: MapLibre's GeoJSONSource otherwise JSON.stringify's on every React render.
 */
export function createHeatmapVisualCache(capacity = 12) {
  const entries = new Map<string, HeatmapRenderView>();
  const identities = new WeakMap<HeatmapWeatherAssessment, number>();
  let nextIdentity = 0, builds = 0;
  let lastTiming = { keyMs: 0, buildMs: 0, serializeMs: 0, cacheHit: false };
  return {
    get builds() { return builds; },
    get lastTiming() { return lastTiming; },
    prepare(lod: HeatmapLod, features: HeatmapHabitatFeature[], weather: Record<string, HeatmapWeatherAssessment>,
      profile: MushroomWeatherProfileId, day: HeatmapTargetDay, baseDate: string) {
      const start = performance.now();
      const weatherIds = [...new Set(features.map(f => f.properties.weatherCellId))].sort();
      const weatherKey = weatherIds.map(id => {
        const assessment = weather[id];
        if (!assessment) return `${id}:missing`;
        if (!identities.has(assessment)) identities.set(assessment, ++nextIdentity);
        return `${id}:${identities.get(assessment)}`;
      }).join(',');
      const key = `${lod}/${profile}/${day}/${baseDate}/${features.map(f => f.properties.id).join(',')}/${weatherKey}`;
      const keyed = performance.now();
      const cached = entries.get(key);
      if (cached) {
        lastTiming = { keyMs: keyed - start, buildMs: 0, serializeMs: 0, cacheHit: true };
        entries.delete(key); entries.set(key, cached); return cached;
      }
      const result = lod === 'overview' ? buildOverviewCollection(weather, features, profile, day)
        : buildHeatmapRenderCollection(weather, features, profile, day);
      const built = performance.now();
      const view = { ...result, serialized: JSON.stringify(result.collection) };
      lastTiming = { keyMs: keyed - start, buildMs: built - keyed, serializeMs: performance.now() - built, cacheHit: false };
      entries.set(key, view); builds++;
      while (entries.size > capacity) entries.delete(entries.keys().next().value!);
      return view;
    },
  };
}

/** Keep an outgoing layer until an incoming useful source has rendered a FULL native frame.
 * No time-based hide and no competing native zoom cutoff. A cancelled handoff cannot hide
 * the currently displayed layer. Both layers overlap for the acknowledged frame.
 */
export interface HeatmapHandoff { displayed: HeatmapLod; incoming?: HeatmapLod }
export function requestHeatmapHandoff(state: HeatmapHandoff, target: HeatmapLod, ready: boolean): HeatmapHandoff {
  const incoming = target !== state.displayed && ready ? target : undefined;
  return incoming === state.incoming ? state : { displayed: state.displayed, incoming };
}
export function finishHeatmapHandoff(state: HeatmapHandoff, expectedTarget = state.incoming): HeatmapHandoff {
  return state.incoming ? { displayed: state.incoming === expectedTarget ? state.incoming : state.displayed } : state;
}
export const heatmapLayerVisible = (state: HeatmapHandoff, lod: HeatmapLod) => state.displayed === lod || state.incoming === lod;

export interface HeatmapRenderProbe { id: string; score: number; renderState: string; dataQuality: string }
export function heatmapRenderProbes(view: HeatmapRenderView, visibleIds: Set<string>, lod: HeatmapLod): HeatmapRenderProbe[] {
  const usable = view.collection.features.filter(f => visibleIds.has(f.properties.id)
    && (lod === 'overview' || f.properties.score >= 0 && f.properties.dataQuality !== 'insufficient'));
  if (!usable.length) return [];
  return [...new Set([0, Math.floor(usable.length / 2), usable.length - 1])].map(i => {
    const { id, score, renderState, dataQuality } = usable[i].properties;
    return { id, score, renderState, dataQuality };
  });
}

/** A map-wide full-frame notification is only a trigger, NOT incoming-layer evidence.
 * Query at most three actual rendered features on that layer. Reject stale replies,
 * then retain the outgoing layer for one additional RAF. No polling/network work.
 */
export function createHeatmapRenderConfirmation(options: {
  query: (lod: HeatmapLod, probes: HeatmapRenderProbe[]) => Promise<Array<{ properties?: Record<string, unknown> | null }>>;
  nextFrame: (callback: () => void) => () => void;
  commit: (lod: HeatmapLod) => void;
}) {
  let generation = 0, target: HeatmapLod | undefined, probes: HeatmapRenderProbe[] = [];
  let querying: number | undefined, cancelFrame: (() => void) | undefined;
  const cancel = () => { generation++; target = undefined; probes = []; cancelFrame?.(); cancelFrame = undefined; };
  return {
    arm(lod: HeatmapLod, expected: HeatmapRenderProbe[]) { cancel(); target = lod; probes = expected; },
    cancel,
    async onFullFrame() {
      if (!target || !probes.length || querying === generation || cancelFrame) return;
      const token = generation, incoming = target, expected = probes;
      querying = token;
      try {
        const rendered = await options.query(incoming, expected);
        if (generation !== token) return;
        const matches = rendered.some(f => expected.some(p => f.properties?.id === p.id && f.properties.score === p.score
          && f.properties.renderState === p.renderState && f.properties.dataQuality === p.dataQuality));
        if (!matches) return; // Old/basemap-only frame: outgoing stays visible until a later frame.
        cancelFrame = options.nextFrame(() => {
          if (generation !== token || target !== incoming) return;
          cancelFrame = undefined;
          target = undefined;
          options.commit(incoming);
        });
      } catch { /* Native style/query not ready: keep the outgoing layer; next frame can retry. */ }
      finally { if (querying === token) querying = undefined; }
    },
  };
}

/** One fixed window per burst, newest value wins; unlike trailing debounce this cannot starve. */
export function createHeatmapVisualCoalescer<T>(commit: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined, latest: T, first = true;
  return {
    push(value: T) {
      latest = value;
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; first = false; commit(latest); }, first ? 0 : HEATMAP_VISUAL.weatherCoalesceMs);
    },
    cancel() { clearTimeout(timer); timer = undefined; },
  };
}

/** Empty/out-of-coverage preparation never clears a previously populated native source. */
export function retainHeatmapGrid(previous: HeatmapRenderView | undefined, next: HeatmapRenderView) {
  return next.collection.features.length || !previous ? next : previous;
}
