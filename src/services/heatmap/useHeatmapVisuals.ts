import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MapRef } from '@maplibre/maplibre-react-native';
import { createHeatmapVisualCache, createHeatmapVisualCoalescer, createHeatmapRenderConfirmation,
  heatmapRenderProbes, heatmapSourceReady, heatmapInteractionLod, finishHeatmapHandoff, heatmapLayerVisible, scheduleHeatmapVisualUpdate, shouldPrewarmHeatmapDetail,
  requestHeatmapHandoff, type HeatmapHandoff, type HeatmapRenderView } from '../../domain/heatmap/visual';
import { OVERVIEW_FEATURES, OVERVIEW_INDEX, type HeatmapLod } from '../../domain/heatmap/lod';
import { REGIONAL_INDEX } from '../../domain/heatmap/regional';
import { localDateFor } from '../../domain/heatmap/assessment';
import type { Bounds } from '../../domain/heatmap/spatial';
import type { MushroomWeatherProfileId } from '../../domain/types';
import type { HeatmapTargetDay } from '../../domain/heatmap/types';
import { weatherAssessmentsFor, type HeatmapPilotBundle } from './pilotHeatmap';

const EMPTY_SOURCE = '{"type":"FeatureCollection","features":[]}';
export function useHeatmapVisuals({ enabled, bounds, moving, lod, zoom, prewarmBounds, bundle, profile, day, mapRef }: {
  enabled: boolean; bounds?: Bounds; moving: boolean; lod: HeatmapLod; zoom: number;
  bundle?: HeatmapPilotBundle; profile: MushroomWeatherProfileId; day: HeatmapTargetDay;
  prewarmBounds?: Bounds;
  mapRef: RefObject<MapRef | null>;
}) {
  const [cache] = useState(() => createHeatmapVisualCache());
  const [visualBounds, setVisualBounds] = useState<Bounds>();
  const [visualBundle, setVisualBundle] = useState<HeatmapPilotBundle>();
  const [coalescer] = useState(() => createHeatmapVisualCoalescer<HeatmapPilotBundle>(setVisualBundle));
  const [views, setViews] = useState<Partial<Record<HeatmapLod, HeatmapRenderView>>>({});
  const [handoff, setHandoff] = useState<HeatmapHandoff>({ displayed: 'overview' });
  const desiredLod = useRef(lod);
  desiredLod.current = lod;
  const lastUpdate = useRef(0);
  const handoffStarted = useRef(0);
  const diagnosticContext = useRef({ zoom, targetLod: lod, displayedLod: handoff.displayed,
    incomingLod: handoff.incoming, outgoingLod: handoff.incoming ? handoff.displayed : undefined,
    incomingSourceReady: false, incomingFeatureCount: 0, expectedVisibleCount: 0 });
  const metrics = useRef({ renderAttempts: 0, commits: 0, overviewDataUpdates: 0, detailDataUpdates: 0 });
  const previousData = useRef<Partial<Record<HeatmapLod, string>>>({});
  const [confirmation] = useState(() => createHeatmapRenderConfirmation({
    query: async incoming => await mapRef.current?.queryRenderedFeatures({
      layers: [incoming === 'detail' ? 'mushroom-heatmap-fill' : 'regional-overview-fill'],
    }) ?? [],
    nextFrame: callback => { const frame = requestAnimationFrame(callback); return () => cancelAnimationFrame(frame); },
    commit: incoming => {
      setHandoff(previous => previous.incoming === incoming && desiredLod.current === incoming
        ? finishHeatmapHandoff(previous, incoming) : previous);
      if (__DEV__) console.info('[heatmap native handoff]', { verifiedLayer: incoming, extraRaf: 1,
        handoffMs: performance.now() - handoffStarted.current, elapsedSinceSourceMs: performance.now() - lastUpdate.current });
    },
    diagnostic: (event, state) => {
      if (__DEV__) console.info('[heatmap-lod]', { event, ...diagnosticContext.current,
        logicalActiveLod: diagnosticContext.current.targetLod, incomingGeneration: state.generation,
        latestRenderConfirmationGeneration: state.confirmedGeneration, renderQueryCount: state.resultCount,
        pendingRaf: state.pendingRaf, frameSequence: state.frameSequence,
        transitionAgeMs: handoffStarted.current ? performance.now() - handoffStarted.current : 0 });
    },
  }));
  metrics.current.renderAttempts++;
  useEffect(() => { metrics.current.commits++; });

  useEffect(() => {
    if (!enabled || moving || !bounds) return;
    return scheduleHeatmapVisualUpdate(() => setVisualBounds(bounds));
  }, [enabled, bounds, moving]);
  useEffect(() => {
    if (!bundle || bundle === visualBundle) return;
    coalescer.push(bundle);
  }, [bundle, visualBundle, coalescer]);
  useEffect(() => () => coalescer.cancel(), [coalescer]);

  // Gesture prewarm is a current visual-only snapshot, not network bounds. A direct
  // jump to detail without one waits for normal 60 ms settlement, retaining old data.
  // The existing settled-source identity and native generations still gate handoff.
  const detailBounds = moving ? prewarmBounds : visualBounds;
  const detailFeatures = useMemo(() => enabled && detailBounds && (lod === 'detail' || shouldPrewarmHeatmapDetail(lod, zoom))
    ? REGIONAL_INDEX.visible(detailBounds) : undefined, [enabled, detailBounds, lod, zoom]);
  const detailVisibleFeatures = useMemo(() => detailFeatures && detailBounds
    ? REGIONAL_INDEX.visible(detailBounds, undefined, 0) : [], [detailFeatures, detailBounds]);
  useEffect(() => {
    if (!enabled) return;
    const start = performance.now(), before = cache.builds;
    const weather = visualBundle ? weatherAssessmentsFor(visualBundle, profile, day) : {};
    const date = visualBundle?.weather.baseLocalDate ?? localDateFor();
    // Only 704 coarse features: keep the whole static overview prewarmed for instant zoom-out.
    // This preparation never requests weather. Detail prewarm is cached-only as well.
    const overview = cache.prepare('overview', OVERVIEW_FEATURES, weather, profile, day, date);
    const overviewTiming = cache.lastTiming;
    const detail = detailFeatures ? cache.prepare('detail', detailFeatures, weather, profile, day, date) : undefined;
    setViews(previous => {
      // Only a prepared, settled empty viewport intentionally replaces data with no-data.
      // Pending preparation never clears the previous source.
      const nextDetail = detail ?? previous.detail;
      if (previous.overview === overview && previous.detail === nextDetail) return previous;
      return { overview, detail: nextDetail };
    });
    if (__DEV__ && cache.builds !== before) console.info('[heatmap visual prepare]', {
      lod, builds: cache.builds - before, detailCells: detailFeatures?.length ?? 0, durationMs: performance.now() - start,
      overviewTiming, detailTiming: detail ? cache.lastTiming : undefined,
    });
  }, [enabled, visualBundle, profile, day, detailFeatures, cache]);

  const baseLocalDate = visualBundle?.weather.baseLocalDate ?? localDateFor();
  const settledBoundsReady = Boolean(bounds && bounds === visualBounds);
  const detailReady = settledBoundsReady && heatmapSourceReady(views.detail, detailFeatures, profile, day, baseLocalDate);
  const overviewReady = settledBoundsReady && heatmapSourceReady(views.overview, OVERVIEW_FEATURES, profile, day, baseLocalDate);
  useEffect(() => {
    setHandoff(previous => requestHeatmapHandoff(previous, lod, lod === 'overview' ? overviewReady : detailReady));
  }, [lod, detailReady, overviewReady]);
  const incomingView = handoff.incoming ? views[handoff.incoming] : undefined;
  const incomingSelectionReady = handoff.incoming === 'detail' ? detailReady : overviewReady;
  const incomingProbes = useMemo(() => {
    if (!incomingView || !handoff.incoming || !visualBounds) return [];
    const visible = handoff.incoming === 'detail' ? detailVisibleFeatures : OVERVIEW_INDEX.visible(visualBounds, undefined, 0);
    return heatmapRenderProbes(incomingView, new Set(visible.map(f => f.properties.id)), handoff.incoming);
  }, [incomingView, handoff.incoming, visualBounds, detailVisibleFeatures]);
  diagnosticContext.current = { zoom, targetLod: lod, displayedLod: handoff.displayed, incomingLod: handoff.incoming,
    outgoingLod: handoff.incoming ? handoff.displayed : undefined, incomingSourceReady: incomingSelectionReady,
    incomingFeatureCount: incomingView?.collection.features.length ?? 0, expectedVisibleCount: incomingProbes.length };
  useEffect(() => {
    if (__DEV__) console.info('[heatmap-lod state]', { ...diagnosticContext.current, detailSourceReady: detailReady });
  }, [lod, handoff, detailReady, overviewReady]);
  // Every incoming source/viewport revision gets a new token. A map-wide frame can
  // only start a native layer query; it can no longer finish the transition itself.
  useLayoutEffect(() => {
    let probeFrame: number | undefined;
    if (handoff.incoming && handoff.incoming === lod && enabled && !moving && incomingSelectionReady) {
      if (!handoffStarted.current) handoffStarted.current = performance.now();
      confirmation.arm(handoff.incoming, incomingProbes);
      // The last native frame may precede the 60 ms JS settlement. If the data is
      // byte-identical, no new native frame is guaranteed. Query existing rendered
      // geometry after this props commit; RAF alone never certifies incoming data.
      probeFrame = requestAnimationFrame(() => { void confirmation.verifyRenderedLayer(); });
    } else confirmation.cancel();
    return () => { if (probeFrame !== undefined) cancelAnimationFrame(probeFrame); confirmation.cancel(); };
  }, [handoff.incoming, incomingProbes, incomingSelectionReady, enabled, moving, lod, confirmation]);
  useEffect(() => { if (!handoff.incoming) handoffStarted.current = 0; }, [handoff.incoming]);
  const onFullyRendered = useCallback(() => {
    void confirmation.onFullFrame();
  }, [confirmation]);
  useEffect(() => {
    lastUpdate.current = performance.now();
    if (views.overview?.serialized !== previousData.current.overview) metrics.current.overviewDataUpdates++;
    if (views.detail?.serialized !== previousData.current.detail) metrics.current.detailDataUpdates++;
    previousData.current = { overview: views.overview?.serialized, detail: views.detail?.serialized };
    if (__DEV__) console.info('[heatmap sources]', { ...metrics.current, rebuilds: cache.builds,
      overviewCells: views.overview?.collection.features.length ?? 0, detailCells: views.detail?.collection.features.length ?? 0 });
  }, [views, cache]);
  return {
    overviewData: views.overview?.serialized ?? EMPTY_SOURCE,
    detailData: views.detail?.serialized ?? EMPTY_SOURCE,
    overviewVisible: enabled && heatmapLayerVisible(handoff, 'overview'),
    detailVisible: enabled && heatmapLayerVisible(handoff, 'detail'),
    targetLod: lod,
    displayedLod: handoff.displayed,
    transitionLod: handoff.incoming,
    interactionLod: heatmapInteractionLod(lod, detailReady),
    detailSourceReady: detailReady,
    onFullyRendered,
  };
}
