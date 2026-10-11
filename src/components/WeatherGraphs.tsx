import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { MushroomWeatherSummary } from '../domain/types';
import { buildWeatherDailySeries, summarySeriesInputs, weatherDateLabel, weatherLocalDate, weatherPlotScale, type WeatherDailySeries } from '../domain/weatherSeries';
import { loadWeatherGraphSeries } from '../services/weatherGraphs';
import { colors, radii, spacing } from '../theme';
import { forecastDashes, graphDate, graphNumber as number, graphPhase, graphPointValues, graphSummary } from './weatherGraphPresentation';

/** Mounted only while graphs are visible; interactions never enter transport. */
export function WeatherGraphs({ summary, location, weatherCellId, locationLabel }: {
  summary?: MushroomWeatherSummary; location?: { latitude: number; longitude: number }; weatherCellId?: string; locationLabel?: string;
}) {
  const db = useSQLiteContext(), today = weatherLocalDate();
  const { latitude, longitude } = location ?? summary ?? { latitude: NaN, longitude: NaN };
  const key = `${latitude}:${longitude}:${weatherCellId ?? ''}:${today}`;
  const [state, setState] = useState<{ key: string; series?: WeatherDailySeries; loading: boolean; error?: string }>({ key, loading: true });
  const [retry, setRetry] = useState(0);
  // Seed may change with profile/day, but it must not restart graph acquisition.
  const seed = useRef(summary); seed.current = summary;
  useEffect(() => {
    let current = true;
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      setState({ key, loading: false, error: 'Lokacija za vremenske grafe ni določena.' });
      return;
    }
    setState(previous => ({ key, series: previous.key === key ? previous.series : undefined, loading: true }));
    void loadWeatherGraphSeries(db, { latitude, longitude, weatherCellId }, today, seed.current)
      .then(series => { if (current) setState({ key, series, loading: false }); })
      .catch(() => { if (current) setState({ key, loading: false, error: 'Vremenskih podatkov trenutno ni mogoče pridobiti.' }); });
    return () => { current = false; };
  }, [db, key, retry]);
  const initial = useMemo(() => buildWeatherDailySeries(latitude, longitude, today,
    summary && summary.latitude === latitude && summary.longitude === longitude ? summarySeriesInputs(summary, today) : []), [summary, latitude, longitude, today]);
  const series = state.key === key && state.series ? state.series : initial;
  const loading = state.key !== key || state.loading;
  const forecastRetrievedAt = series.points.find(point => point.kind === 'forecast' && point.fetchedAt)?.fetchedAt;
  return <View style={styles.graphs}>
    {locationLabel ? <Text style={styles.secondary}>{locationLabel}</Text> : null}
    <Text style={styles.secondary}>Open-Meteo · 30 dni zgodovine in 7 dni napovedi</Text>
    {forecastRetrievedAt ? <Text style={styles.secondary}>Napoved pridobljena {new Date(forecastRetrievedAt).toLocaleString('sl-SI', { timeZone: series.timezone })}{series.stale ? ' · starejši podatki' : ''}</Text> : null}
    {loading ? <View style={styles.loading}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.secondary}>Pridobivam dnevno vreme …</Text></View> : null}
    {series.availableRange ? <WeatherGraphPair key={key} series={series} /> : !loading ? <Text style={styles.secondary}>Dnevni vremenski podatki niso na voljo.</Text> : null}
    {!loading && (state.error || series.partial || series.stale) ? <>
      <Text style={styles.secondary}>{state.error ?? (series.stale ? 'Prikazani so tudi starejši podatki iz predpomnilnika.' : 'Nekateri dnevi ali vremenske vrednosti niso na voljo.')}</Text>
      <Pressable accessibilityRole="button" onPress={() => setRetry(n => n + 1)} style={styles.retry}><Text style={styles.heading}>Poskusi znova</Text></Pressable>
    </> : null}
    <Text style={styles.secondary}>Open-Meteo · modelski podatki, ne meritve na rastišču. Padavine vključujejo tudi sneg. Danes je še nedokončan dan.</Text>
  </View>;
}

export function WeatherGraphPair({ series }: { series: WeatherDailySeries }) {
  const [selectedDate, setSelectedDate] = useState(series.today);
  return <View style={styles.graphs}>{(['rain', 'temperature'] as const).map(metric =>
    <DailyWeatherChart key={metric} series={series} metric={metric} selectedDate={selectedDate} onSelect={setSelectedDate} />)}</View>;
}
const HEIGHT = 144;

export function DailyWeatherChart({ series, metric, selectedDate, onSelect }: {
  series: WeatherDailySeries; metric: 'rain' | 'temperature'; selectedDate: string; onSelect: (date: string) => void;
}) {
  const scroll = useRef<ScrollView>(null), positioned = useRef(false);
  const { fontScale } = useWindowDimensions();
  const CELL = Math.max(48, 48 * fontScale), TOP = Math.max(32, 32 * fontScale), bottom = Math.max(48, 48 * fontScale);
  const plotHeight = HEIGHT * Math.max(1, fontScale);
  const overview = useMemo(() => graphSummary(series, metric), [series, metric]);
  const scale = useMemo(() => weatherPlotScale(series.points, metric), [series, metric]);
  const y = (value: number) => TOP + plotHeight * (1 - (value - scale.min) / (scale.max - scale.min));
  const selected = series.points.find(p => p.date === selectedDate) ?? series.points[30];
  const phase = graphPhase(selected, series.today);
  const title = metric === 'rain' ? 'Padavine' : 'Temperatura';
  const retrieval = selected.fetchedAt && (selected.kind === 'forecast' || selected.stale)
    ? `Pridobljeno: ${new Date(selected.fetchedAt).toLocaleString('sl-SI', { timeZone: series.timezone })}` : null;
  const hasValues = series.points.some(p => metric === 'rain' ? p.precipitationMm != null : [p.temperatureMeanC, p.temperatureMinC, p.temperatureMaxC].some(v => v != null));
  return <View style={styles.chart} accessible={false}>
    <Text accessibilityRole="header" accessibilityLabel={`Graf: ${title}`} style={styles.chartTitle}>{title}</Text>
    <Text style={styles.chartSubtitle}>{metric === 'rain' ? 'Dnevne padavine · mm, tudi sneg' : 'Dnevno povprečje in min/max · °C'}</Text>
    <View accessible accessibilityRole="text" accessibilityLabel={`${title}. 30 preteklih dni in 7 dni napovedi. ${overview.description}`}
      accessibilityHint="Povzetek grafa. Za posamezne datume se pomaknite do gumbov za dneve." style={styles.summary}>
      {overview.signals.map(signal => <View key={signal.label} style={styles.summarySignal}>
        <Text style={styles.summaryLabel}>{signal.label}</Text><Text style={styles.summaryValue}>{signal.text}</Text>
      </View>)}
      {overview.trend ? <Text style={styles.trend}>{overview.trend}</Text> : null}
      {series.stale ? <Text style={styles.trend}>Vključeni so starejši podatki.</Text> : null}
    </View>
    <View accessible accessibilityRole="text" accessibilityLabel={`Legenda. Pretekli podatki: ${metric === 'rain' ? 'polni stolpci' : 'polna črta'}. Napoved: ${metric === 'rain' ? 'obrobljeni stolpci' : 'črtkana črta'}. Navpična črta označuje danes.`} style={styles.legend}>
      <View style={styles.legendItem}><View style={metric === 'rain' ? styles.legendBar : styles.legendLine} /><Text style={styles.legendText}>Pretekli podatki</Text></View>
      <View style={styles.legendItem}>{metric === 'rain' ? <View style={styles.legendForecastBar} /> : <View style={styles.legendDashRow}>{[0, 1, 2].map(i => <View key={i} style={styles.legendDash} />)}</View>}<Text style={styles.legendText}>Napoved</Text></View>
    </View>
    {!hasValues ? <Text style={styles.secondary}>{metric === 'rain' ? 'Podatki o padavinah niso na voljo.' : 'Podatki o temperaturi niso na voljo.'}</Text> : null}
    <View style={styles.plotRow}>
      <View style={[styles.axis, { width: Math.ceil(44 * Math.max(1, fontScale)), height: TOP + plotHeight + bottom }]} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{scale.ticks.map(tick => <Text key={tick} style={[styles.tick, { top: y(tick) - 9 * fontScale }]}>{tick.toLocaleString('sl-SI', { maximumFractionDigits: 1 })}</Text>)}</View>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled
        accessible={false} accessibilityLabel={`${title}: dnevne vrednosti`} accessibilityHint="Pomaknite se med dnevi in izberite datum za podrobnosti."
        onLayout={event => { if (!positioned.current && event.nativeEvent.layout.width > 0) {
          positioned.current = true; scroll.current?.scrollTo({ x: Math.max(0, 30 * CELL - event.nativeEvent.layout.width * .45), animated: false });
        } }} contentContainerStyle={styles.plotScroll}>
        <View style={{ width: CELL * 37, height: TOP + plotHeight + bottom }}>
          <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={[styles.forecastZone, { left: CELL * 30, width: CELL * 7, top: TOP, height: plotHeight }]} />
          {scale.ticks.map(tick => <View key={tick} pointerEvents="none" style={[styles.gridline, { top: y(tick) }]} />)}
          <View pointerEvents="none" style={[styles.todayBoundary, { left: CELL * 30, height: TOP + plotHeight }]} />
          <Text style={[styles.todayLabel, { left: CELL * 30 + 4 }]}>Danes →</Text>
          {metric === 'temperature' ? series.points.slice(0, -1).map((point, i) => {
            const next = series.points[i + 1];
            if (point.temperatureMeanC == null || next.temperatureMeanC == null) return null;
            const dy = y(next.temperatureMeanC) - y(point.temperatureMeanC), length = Math.hypot(CELL, dy);
            const forecast = next.kind === 'forecast';
            return <View key={point.date} pointerEvents="none" testID={forecast ? 'weather-forecast-line' : 'weather-history-line'} style={[styles.line, { width: length,
              left: i * CELL + CELL - length / 2, top: y(point.temperatureMeanC) + dy / 2 - 1.5,
              backgroundColor: forecast ? 'transparent' : colors.primary,
              transform: [{ rotate: `${Math.atan2(dy, CELL)}rad` }] }]}>
              {forecast ? forecastDashes(length).map(dash => <View key={dash.left} style={[styles.forecastDash, dash]} />) : null}
            </View>;
          }) : null}
          </View>
          {series.points.map((point, i) => {
            const active = selected.date === point.date, forecast = point.kind === 'forecast';
            const color = forecast ? colors.accent : colors.primary;
            const value = metric === 'rain' ? point.precipitationMm : point.temperatureMeanC;
            return <Pressable key={point.date} accessibilityRole="button" accessibilityState={{ selected: active }}
              accessibilityLabel={`${title}, ${graphDate(point.date)}. ${graphPhase(point, series.today)}. ${graphPointValues(point, metric)}${point.stale ? ' Starejši podatki.' : ''}`}
              accessibilityHint="Izbere ta dan v obeh grafih in prikaže njegove vrednosti pod grafom."
              onPress={() => onSelect(point.date)} style={[styles.day, { left: i * CELL, width: CELL, height: TOP + plotHeight + bottom }, active && styles.selectedDay]}>
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={StyleSheet.absoluteFill}>
              {active ? <View style={[styles.selectedRail, { top: TOP, height: plotHeight, left: CELL / 2 - 1 }]} /> : null}
              {metric === 'rain' && value != null ? <View pointerEvents="none" style={[styles.bar, { left: CELL / 2 - 12, top: y(value), height: Math.max(2, TOP + plotHeight - y(value)), backgroundColor: forecast ? colors.surface : color, borderColor: color }, active && styles.activeBar]} /> : null}
              {metric === 'temperature' && point.temperatureMinC != null && point.temperatureMaxC != null && point.temperatureMaxC >= point.temperatureMinC ? <View pointerEvents="none" style={[styles.range, { left: CELL / 2 - 2, top: y(point.temperatureMaxC), height: Math.max(2, y(point.temperatureMinC) - y(point.temperatureMaxC)), backgroundColor: color }]} /> : null}
              {metric === 'temperature' ? [point.temperatureMinC, point.temperatureMaxC].map((v, index) => v == null ? null : <View key={index} pointerEvents="none" style={[styles.rangeCap, { left: CELL / 2 - 5, top: y(v), backgroundColor: color }]} />) : null}
              {metric === 'temperature' && value != null ? <View pointerEvents="none" style={[styles.dot, { left: CELL / 2 - (active ? 7 : 5), top: y(value) - (active ? 7 : 5), backgroundColor: forecast ? colors.surface : color, borderColor: color }, active && styles.activeDot]} /> : null}
              {value == null ? <Text style={[styles.missing, { left: CELL / 2 - 8, top: TOP + plotHeight - 22 }]}>—</Text> : null}
              <Text style={[styles.date, { width: CELL, top: TOP + plotHeight + 8 }, active && styles.activeDate]}>{weatherDateLabel(point.date)}{active ? '\n▲' : ''}</Text>
              </View>
            </Pressable>;
          })}
        </View>
      </ScrollView>
    </View>
    <Text style={styles.secondary}>Povleci levo/desno · tapni dan za vrednosti</Text>
    <View style={styles.selection} accessible accessibilityRole="text" accessibilityLiveRegion="polite"
      accessibilityLabel={`Izbrano: ${title}. ${graphDate(selected.date)}. ${phase}. ${graphPointValues(selected, metric)}${selected.stale ? ' Starejši podatki iz predpomnilnika.' : ''}${retrieval ? ` ${retrieval}` : ''}`}>
      <View style={styles.selectionHeader}><Text style={styles.selectionTitle}>{weatherDateLabel(selected.date)} {selected.date.slice(0, 4)}</Text><Text style={styles.phase}>{phase}</Text></View>
      <Text style={styles.value}>{metric === 'rain' ? number(selected.precipitationMm, 'mm') : number(selected.temperatureMeanC, '°C')}<Text style={styles.unitLabel}>{metric === 'rain' ? selected.precipitationMm == null ? '' : ' padavin' : ' · povprečje'}</Text></Text>
      {metric === 'temperature' ? <Text style={styles.temperatureExtras}>Min: {number(selected.temperatureMinC, '°C')} · Max: {number(selected.temperatureMaxC, '°C')}</Text> : null}
      {selected.stale ? <Text style={styles.secondary}>Starejši podatki iz predpomnilnika</Text> : null}
      {retrieval ? <Text style={styles.secondary}>{retrieval}</Text> : null}
    </View>
  </View>;
}
const styles = StyleSheet.create({ graphs: { gap: spacing.lg }, chart: { gap: spacing.sm },
  heading: { fontSize: 16, fontWeight: '600', color: colors.primary }, secondary: { fontSize: 13, lineHeight: 18, color: colors.muted },
  chartTitle: { fontSize: 18, fontWeight: '600', color: colors.primary }, chartSubtitle: { fontSize: 14, color: colors.text },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.surfaceSoft, borderRadius: radii.sm },
  summarySignal: { flexGrow: 1, flexShrink: 1, flexBasis: 120, gap: spacing.xs }, summaryLabel: { fontSize: 13, color: colors.text },
  summaryValue: { fontSize: 16, fontWeight: '600', color: colors.primary }, trend: { width: '100%', fontSize: 14, color: colors.text },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }, legendItem: { flexDirection: 'row', maxWidth: '100%', alignItems: 'center', gap: spacing.sm },
  legendText: { flexShrink: 1, fontSize: 14, color: colors.text }, legendBar: { width: 12, height: 14, backgroundColor: colors.primary },
  legendForecastBar: { width: 12, height: 14, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.accent },
  legendLine: { width: 28, height: 3, backgroundColor: colors.primary }, legendDashRow: { flexDirection: 'row', gap: 3 },
  legendDash: { width: 7, height: 3, backgroundColor: colors.accent },
  loading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  plotRow: { flexDirection: 'row' }, axis: { width: 44 }, tick: { position: 'absolute', right: 4, fontSize: 13, color: colors.text },
  plotScroll: { flexGrow: 0 }, day: { position: 'absolute', minHeight: 48 }, selectedDay: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  selectedRail: { position: 'absolute', width: 2, backgroundColor: colors.border },
  gridline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  forecastZone: { position: 'absolute', backgroundColor: colors.background },
  todayBoundary: { position: 'absolute', borderLeftWidth: 2, borderColor: colors.accent },
  todayLabel: { position: 'absolute', top: 4, fontSize: 14, fontWeight: '600', color: colors.primary },
  bar: { position: 'absolute', width: 24, borderWidth: 2, borderTopLeftRadius: 3, borderTopRightRadius: 3 }, activeBar: { borderColor: colors.text, borderWidth: 3 },
  line: { position: 'absolute', height: 3 }, forecastDash: { position: 'absolute', height: 3, backgroundColor: colors.accent },
  dot: { position: 'absolute', width: 10, height: 10, borderWidth: 2, borderRadius: 5 }, activeDot: { width: 14, height: 14, borderWidth: 3, borderRadius: 7, borderColor: colors.text },
  range: { position: 'absolute', left: 20, width: 4, opacity: .3 }, missing: { position: 'absolute', left: 16, fontSize: 16, color: colors.muted },
  rangeCap: { position: 'absolute', width: 10, height: 1, opacity: .5 },
  date: { position: 'absolute', textAlign: 'center', fontSize: 13, color: colors.text }, activeDate: { fontWeight: '700', color: colors.primary },
  selection: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.primary, borderRadius: radii.sm, padding: spacing.sm, gap: spacing.xs },
  selectionHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: spacing.sm },
  selectionTitle: { color: colors.primary, fontSize: 14, fontWeight: '600' }, phase: { flexShrink: 1, fontSize: 13, color: colors.text },
  value: { fontSize: 20, fontWeight: '600', color: colors.primary }, unitLabel: { fontSize: 13, fontWeight: '400', color: colors.text },
  temperatureExtras: { fontSize: 14, color: colors.text },
  retry: { minHeight: 44, justifyContent: 'center' } });
