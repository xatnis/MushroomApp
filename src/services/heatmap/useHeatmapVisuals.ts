import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MapRef } from '@maplibre/maplibre-react-native';
import { HEATMAP_VISUAL, createHeatmapVisualCache, createHeatmapVisualCoalescer, createHeatmapRenderConfirmation,
  heatmapRenderProbes, finishHeatmapHandoff, heatmapLayerVisible, scheduleHeatmapVisualUpdate,
  requestHeatmapHandoff, retainHeatmapGrid, type HeatmapHandoff, type HeatmapRenderView } from '../../domain/heatmap/visual';
import { OVERVIEW_FEATURES, OVERVIEW_INDEX, type HeatmapLod } from '../../domain/heatmap/lod';
import { REGIONAL_INDEX } from '../../domain/heatmap/regional';
import { localDateFor } from '../../domain/heatmap/assessment';
import type { Bounds } from '../../domain/heatmap/spatial';
import type { MushroomWeatherProfileId } from '../../domain/types';
import type { HeatmapTargetDay } from '../../domain/heatmap/types';
import { weatherAssessmentsFor, type HeatmapPilotBundle } from './pilotHeatmap';
import { shiftLocalDate } from '../weather';

const EMPTY_SOURCE = '{"type":"FeatureCollection","features":[]}';
export function useHeatmapVisuals({ enabled, bounds, moving, lod, zoom, bundle, profile, day, mapRef }: {
  enabled: boolean; bounds?: Bounds; moving: boolean; lod: HeatmapLod; zoom: number;
  bundle?: HeatmapPilotBundle; profile: MushroomWeatherProfileId; day: HeatmapTargetDay;
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
  const metrics = useRef({ renderAttempts: 0, commits: 0, overviewDataUpdates: 0, detailDataUpdates: 0 });
  const previousData = useRef<Partial<Record<HeatmapLod, string>>>({});
  const [confirmation] = useState(() => createHeatmapRenderConfirmation({
    query: async (incoming, probes) => await mapRef.current?.queryRenderedFeatures({
      layers: [incoming === 'detail' ? 'mushroom-heatmap-fill' : 'regional-overview-fill'],
      filter: ['in', ['get', 'id'], ['literal', probes.map(p => p.id)]],
    }) ?? [],
    nextFrame: callback => { const frame = requestAnimationFrame(callback); return () => cancelAnimationFrame(frame); },
    commit: incoming => {
      setHandoff(previous => previous.incoming === incoming && desiredLod.current === incoming
        ? finishHeatmapHandoff(previous, incoming) : previous);
      if (__DEV__) console.info('[heatmap native handoff]', { verifiedLayer: incoming, extraRaf: 1,
        handoffMs: performance.now() - handoffStarted.current, elapsedSinceSourceMs: performance.now() - lastUpdate.current });
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

  const detailFeatures = useMemo(() => enabled && visualBounds && (lod === 'detail' || zoom >= HEATMAP_VISUAL.detailPrewarmZoom)
    ? REGIONAL_INDEX.visible(visualBounds) : undefined, [enabled, visualBounds, lod, zoom]);
  const detailVisibleFeatures = useMemo(() => detailFeatures && visualBounds
    ? REGIONAL_INDEX.visible(visualBounds, undefined, 0) : [], [detailFeatures, visualBounds]);
  useEffect(() => {
    if (!enabled) return;
    const start = performance.now(), before = cache.builds;
    const weather = visualBundle ? weatherAssessmentsFor(visualBundle, profile, day) : {};
    const date = visualBundle?.weather.baseLocalDate ?? localDateFor();
    // Only 704 coarse features: keep the whole static overview prewarmed for instant zoom-out.
    // This preparation never requests weather. Detail prewarm is cached-only as well.
    const overview = cache.prepare('overview', OVERVIEW_FEATURES, weather, profile, day, date);
    const overviewTiming = cache.lastTiming;
    const detail = detailFeatures?.length ? cache.prepare('detail', detailFeatures, weather, profile, day, date) : undefined;
    setViews(previous => {
      const nextDetail = detail ? retainHeatmapGrid(previous.detail, detail) : previous.detail;
      if (previous.overview === overview && previous.detail === nextDetail) return previous;
      return { overview, detail: nextDetail };
    });
    if (__DEV__ && cache.builds !== before) console.info('[heatmap visual prepare]', {
      lod, builds: cache.builds - before, detailCells: detailFeatures?.length ?? 0, durationMs: performance.now() - start,
      overviewTiming, detailTiming: detail ? cache.lastTiming : undefined,
    });
  }, [enabled, visualBundle, profile, day, detailFeatures, cache]);

  const targetLocalDate = shiftLocalDate(visualBundle?.baseLocalDate ?? localDateFor(), day === 'tomorrow' ? 1 : 0);
  const detailReady = Boolean(views.detail && detailVisibleFeatures.some(f => {
    const a = views.detail?.assessments[f.properties.id];
    return a && a.speciesId === profile && a.targetDay === day && a.targetLocalDate === targetLocalDate
      && a.score !== null && a.dataQuality !== 'insufficient';
  }));
  useEffect(() => {
    setHandoff(previous => requestHeatmapHandoff(previous, lod, lod === 'overview' ? Boolean(views.overview) : detailReady));
  }, [lod, detailReady, views.overview]);
  const incomingView = handoff.incoming ? views[handoff.incoming] : undefined;
  const firstIncomingId = incomingView?.collection.features[0]?.properties.id;
  const incomingAssessment = firstIncomingId ? incomingView?.assessments[firstIncomingId] : undefined;
  const incomingSelectionReady = incomingAssessment?.speciesId === profile && incomingAssessment.targetDay === day
    && incomingAssessment.targetLocalDate === targetLocalDate && (handoff.incoming !== 'detail' || detailReady);
  const incomingProbes = useMemo(() => {
    if (!incomingView || !handoff.incoming || !visualBounds) return [];
    const visible = handoff.incoming === 'detail' ? detailVisibleFeatures : OVERVIEW_INDEX.visible(visualBounds, undefined, 0);
    return heatmapRenderProbes(incomingView, new Set(visible.map(f => f.properties.id)), handoff.incoming);
  }, [incomingView, handoff.incoming, visualBounds, detailVisibleFeatures]);
  // Every incoming source/viewport revision gets a new token. A map-wide frame can
  // only start a native layer query; it can no longer finish the transition itself.
  useLayoutEffect(() => {
    if (handoff.incoming && handoff.incoming === lod && enabled && !moving && incomingSelectionReady) {
      handoffStarted.current = performance.now();
      confirmation.arm(handoff.incoming, incomingProbes);
    } else confirmation.cancel();
    return () => confirmation.cancel();
  }, [handoff.incoming, incomingProbes, incomingSelectionReady, enabled, moving, lod, confirmation]);
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
    onFullyRendered,
  };
}
