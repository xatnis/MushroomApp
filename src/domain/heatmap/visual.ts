import { buildHeatmapRenderCollection } from './regional';
import { OVERVIEW_FEATURES, buildOverviewCollection, type HeatmapLod } from './lod';
import type { MushroomWeatherProfileId } from '../types';
import type { HeatmapHabitatFeature, HeatmapTargetDay, HeatmapWeatherAssessment } from './types';

// Display policy only. Network settlement remains independently debounced at 250 ms.
export const HEATMAP_VISUAL = { viewportDelayMs: 60, weatherCoalesceMs: 80, detailPrewarmZoom: 8.8 } as const;
export const shouldPrewarmHeatmapDetail = (target: HeatmapLod, zoom: number) =>
  target === 'overview' && Number.isFinite(zoom) && zoom >= HEATMAP_VISUAL.detailPrewarmZoom;
// Already overlapping before this pass; native zoom MUST NOT override render readiness.
export const HEATMAP_NATIVE_RANGES = { overview: { min: 0, max: 24 }, detail: { min: 0, max: 24 } } as const;
export function scheduleHeatmapVisualUpdate(callback: () => void, delayMs: number = HEATMAP_VISUAL.viewportDelayMs) {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}
export type HeatmapRenderView = ReturnType<typeof buildHeatmapRenderCollection> & { serialized: string; selectionKey: string };

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
      // Private visual revision identity, never serialized into native/model/data artifacts.
      const view = { ...result, serialized: JSON.stringify(result.collection), selectionKey: `${profile}/${day}/${baseDate}` };
      lastTiming = { keyMs: keyed - start, buildMs: built - keyed, serializeMs: performance.now() - built, cacheHit: false };
      entries.set(key, view); builds++;
      while (entries.size > capacity) entries.delete(entries.keys().next().value!);
      return view;
    },
  };
}

/** A source data update is NOT a LOD transition. Publish the target source before
 * scheduling any inactive prewarm. At detail LOD the overview is rebuilt only when
 * requested again; its mounted old revision cannot pass current-selection readiness.
 * Superseded deferred work may not publish, even if cancellation races with a task. */
export function createHeatmapSourcePreparation(
  cache: ReturnType<typeof createHeatmapVisualCache>,
  publish: (lod: HeatmapLod, view: HeatmapRenderView) => void,
  defer: (callback: () => void) => () => void,
) {
  let generation = 0, cancelDeferred: (() => void) | undefined;
  const cancel = () => { generation++; cancelDeferred?.(); cancelDeferred = undefined; };
  return {
    cancel,
    update({ lod, detailFeatures, weather, profile, day, date }: {
      lod: HeatmapLod; detailFeatures?: HeatmapHabitatFeature[];
      weather: Record<string, HeatmapWeatherAssessment>; profile: MushroomWeatherProfileId;
      day: HeatmapTargetDay; date: string;
    }) {
      cancel();
      const token = generation, features = lod === 'overview' ? OVERVIEW_FEATURES : detailFeatures;
      if (!features) return;
      const active = cache.prepare(lod, features, weather, profile, day, date);
      publish(lod, active);
      if (lod === 'overview' && detailFeatures) cancelDeferred = defer(() => {
        if (token !== generation) return;
        const detail = cache.prepare('detail', detailFeatures, weather, profile, day, date);
        if (token === generation) publish('detail', detail);
      });
      return active;
    },
  };
}

/** Keep an outgoing layer until current incoming geometry has native render evidence.
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
export const heatmapInteractionLod = (target: HeatmapLod, detailSourceReady: boolean): HeatmapLod | undefined =>
  target === 'overview' ? 'overview' : detailSourceReady ? 'detail' : undefined;

/** Geometry readiness is independent of weather readiness (neutral/no-data cells are valid).
 * A settled, genuinely empty viewport is also a valid detail source, not pending work.
 */
export function heatmapSourceReady(view: HeatmapRenderView | undefined, expected: HeatmapHabitatFeature[] | undefined,
  profile: MushroomWeatherProfileId, day: HeatmapTargetDay, baseDate: string) {
  if (!view || !expected || view.selectionKey !== `${profile}/${day}/${baseDate}`
    || view.collection.features.length !== expected.length) return false;
  return expected.every((f, i) => view.collection.features[i]?.properties.id === f.properties.id);
}

export interface HeatmapRenderProbe { id: string; score: number; renderState: string; dataQuality: string }
export function heatmapRenderProbes(view: HeatmapRenderView, visibleIds: Set<string>, _lod: HeatmapLod): HeatmapRenderProbe[] {
  return view.collection.features.filter(f => visibleIds.has(f.properties.id)).map(f => {
    const { id, score, renderState, dataQuality } = f.properties;
    return { id, score, renderState, dataQuality };
  });
}

/** A map-wide render notification is only a trigger, NOT incoming-layer evidence.
 * Query the whole viewport/layer, not three sampled IDs. Reject stale replies,
 * retain events arriving during queries, then overlap one RAF. No polling/network work.
 */
export function createHeatmapRenderConfirmation(options: {
  query: (lod: HeatmapLod, probes: HeatmapRenderProbe[]) => Promise<Array<{ properties?: Record<string, unknown> | null }>>;
  nextFrame: (callback: () => void) => () => void;
  commit: (lod: HeatmapLod) => void;
  diagnostic?: (event: string, state: { generation: number; confirmedGeneration?: number; resultCount: number;
    pendingRaf: boolean; frameSequence: number }) => void;
}) {
  let generation = 0, target: HeatmapLod | undefined, probes: HeatmapRenderProbe[] = [];
  let querying: number | undefined, cancelFrame: (() => void) | undefined;
  let frames = 0, submittedAfterFrame = 0, confirmedGeneration: number | undefined, resultCount = 0;
  const diagnostic = (event: string) => options.diagnostic?.(event, { generation, confirmedGeneration, resultCount,
    pendingRaf: Boolean(cancelFrame), frameSequence: frames });
  const cancel = () => { generation++; target = undefined; probes = []; cancelFrame?.(); cancelFrame = undefined; };
  const confirmation = {
    arm(lod: HeatmapLod, expected: HeatmapRenderProbe[]) {
      cancel(); target = lod; probes = expected; resultCount = 0; submittedAfterFrame = frames; diagnostic('source-submitted');
    },
    cancel,
    async onFullFrame() {
      frames++;
      return confirmation.verifyRenderedLayer();
    },
    async verifyRenderedLayer() {
      if (!target || querying === generation || cancelFrame) return;
      // An empty source cannot prove itself with a query: require a real new native frame.
      if (!probes.length && frames <= submittedAfterFrame) return;
      const token = generation, incoming = target, expected = probes;
      const frameAtQuery = frames;
      querying = token;
      diagnostic('render-query');
      try {
        // Zero expected features: a post-submission frame can confirm intentional no-data.
        const rendered = expected.length ? await options.query(incoming, expected) : [];
        if (generation !== token) return;
        resultCount = rendered.length;
        const byId = new Map(expected.map(p => [p.id, p]));
        const matches = !expected.length || rendered.some(f => {
          const p = byId.get(f.properties?.id as string);
          return p && f.properties?.score === p.score && f.properties.renderState === p.renderState
            && f.properties.dataQuality === p.dataQuality;
        });
        if (matches) confirmedGeneration = token;
        diagnostic(matches ? 'render-confirmed' : 'render-pending');
        if (!matches) return; // Old/basemap-only frame: outgoing stays visible until a later frame.
        cancelFrame = options.nextFrame(() => {
          if (generation !== token || target !== incoming) return;
          cancelFrame = undefined;
          target = undefined;
          options.commit(incoming);
          diagnostic('handoff-complete');
        });
        diagnostic('overlap-raf');
      } catch { if (generation === token) diagnostic('query-failed'); }
      finally {
        if (querying === token) {
          querying = undefined;
          // A newer frame received during a slow query is not lost. No timer retry loop.
          if (generation === token && target && !cancelFrame && frames > frameAtQuery) void confirmation.verifyRenderedLayer();
        }
      }
    },
  };
  return confirmation;
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
