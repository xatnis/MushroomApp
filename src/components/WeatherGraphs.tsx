import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { MushroomWeatherSummary } from '../domain/types';
import { buildWeatherDailySeries, summarySeriesInputs, weatherDateLabel, weatherLocalDate, weatherPlotScale, type WeatherDailySeries } from '../domain/weatherSeries';
import { loadWeatherGraphSeries } from '../services/weatherGraphs';
import { colors, radii, spacing } from '../theme';

/** Mounted only inside expanded weather details; interactions never enter transport. */
export function WeatherGraphs({ summary, weatherCellId, locationLabel }: { summary: MushroomWeatherSummary; weatherCellId?: string; locationLabel?: string }) {
  const db = useSQLiteContext(), today = weatherLocalDate();
  const { latitude, longitude } = summary;
  const key = `${latitude}:${longitude}:${weatherCellId ?? ''}:${today}`;
  const [state, setState] = useState<{ key: string; series?: WeatherDailySeries; loading: boolean; error?: string }>({ key, loading: true });
  const [retry, setRetry] = useState(0);
  // Seed may change with profile/day, but it must not restart graph acquisition.
  const seed = useRef(summary); seed.current = summary;
  useEffect(() => {
    let current = true;
    setState(previous => ({ key, series: previous.key === key ? previous.series : undefined, loading: true }));
    void loadWeatherGraphSeries(db, { latitude, longitude, weatherCellId }, today, seed.current)
      .then(series => { if (current) setState({ key, series, loading: false }); })
      .catch(() => { if (current) setState({ key, loading: false, error: 'Vremenskih podatkov trenutno ni mogoče pridobiti.' }); });
    return () => { current = false; };
  }, [db, key, retry]);
  const initial = useMemo(() => buildWeatherDailySeries(latitude, longitude, today, summarySeriesInputs(summary, today)), [summary, today]);
  const series = state.key === key && state.series ? state.series : initial;
  const loading = state.key !== key || state.loading;
  return <View style={styles.graphs}>
    {locationLabel ? <Text style={styles.secondary}>{locationLabel}</Text> : null}
    <Text style={styles.secondary}>Pretekli modelski vremenski podatki · 30 dni in 7-dnevna napoved</Text>
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
const number = (value: number | null, unit: string) => value == null ? 'Ni podatka' : `${value.toLocaleString('sl-SI', { maximumFractionDigits: 1 })} ${unit}`;

export function DailyWeatherChart({ series, metric, selectedDate, onSelect }: {
  series: WeatherDailySeries; metric: 'rain' | 'temperature'; selectedDate: string; onSelect: (date: string) => void;
}) {
  const scroll = useRef<ScrollView>(null), positioned = useRef(false);
  const { fontScale } = useWindowDimensions();
  const CELL = Math.max(44, 44 * fontScale), TOP = Math.max(28, 28 * fontScale), bottom = Math.max(44, 44 * fontScale);
  const scale = useMemo(() => weatherPlotScale(series.points, metric), [series, metric]);
  const y = (value: number) => TOP + HEIGHT * (1 - (value - scale.min) / (scale.max - scale.min));
  const selected = series.points.find(p => p.date === selectedDate) ?? series.points[30];
  const phase = selected.kind === 'historical' ? 'Pretekli modelski podatki' : selected.date === series.today ? 'Danes · napoved, nedokončan dan' : 'Napoved';
  const detail = metric === 'rain' ? number(selected.precipitationMm, 'mm')
    : `Povprečje: ${number(selected.temperatureMeanC, '°C')} · min: ${number(selected.temperatureMinC, '°C')} · max: ${number(selected.temperatureMaxC, '°C')}`;
  const hasValues = series.points.some(p => metric === 'rain' ? p.precipitationMm != null : [p.temperatureMeanC, p.temperatureMinC, p.temperatureMaxC].some(v => v != null));
  return <View style={styles.chart}>
    <Text style={styles.heading}>{metric === 'rain' ? 'Padavine' : 'Temperatura'} <Text style={styles.secondary}>{metric === 'rain' ? 'mm / dan' : '°C · povprečje in razpon'}</Text></Text>
    <Text style={styles.legend}>● Pretekli podatki   ◇ Napoved</Text>
    {!hasValues ? <Text style={styles.secondary}>{metric === 'rain' ? 'Podatki o padavinah niso na voljo.' : 'Podatki o temperaturi niso na voljo.'}</Text> : null}
    <View style={styles.plotRow}>
      <View style={[styles.axis, { width: Math.ceil(38 * Math.max(1, fontScale)), height: TOP + HEIGHT + bottom }]} accessible={false}>{scale.ticks.map(tick => <Text key={tick} style={[styles.tick, { top: y(tick) - 8 }]}>{tick.toLocaleString('sl-SI', { maximumFractionDigits: 1 })}</Text>)}</View>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled
        onLayout={event => { if (!positioned.current && event.nativeEvent.layout.width > 0) {
          positioned.current = true; scroll.current?.scrollTo({ x: Math.max(0, 30 * CELL - event.nativeEvent.layout.width * .45), animated: false });
        } }} contentContainerStyle={styles.plotScroll}>
        <View style={{ width: CELL * 37, height: TOP + HEIGHT + bottom }}>
          {scale.ticks.map(tick => <View key={tick} pointerEvents="none" style={[styles.gridline, { top: y(tick) }]} />)}
          <View pointerEvents="none" style={[styles.todayBoundary, { left: CELL * 30, height: TOP + HEIGHT }]} />
          <Text style={[styles.todayLabel, { left: CELL * 30 + 4 }]}>Danes →</Text>
          {metric === 'temperature' ? series.points.slice(0, -1).map((point, i) => {
            const next = series.points[i + 1];
            if (point.temperatureMeanC == null || next.temperatureMeanC == null) return null;
            const dy = y(next.temperatureMeanC) - y(point.temperatureMeanC), length = Math.hypot(CELL, dy);
            return <View key={point.date} pointerEvents="none" style={[styles.line, { width: length,
              left: i * CELL + CELL - length / 2, top: y(point.temperatureMeanC) + dy / 2 - 1,
              backgroundColor: next.kind === 'forecast' ? colors.accent : colors.primary,
              transform: [{ rotate: `${Math.atan2(dy, CELL)}rad` }] }]} />;
          }) : null}
          {series.points.map((point, i) => {
            const active = selected.date === point.date, forecast = point.kind === 'forecast';
            const color = forecast ? colors.accent : colors.primary;
            const value = metric === 'rain' ? point.precipitationMm : point.temperatureMeanC;
            return <Pressable key={point.date} accessibilityRole="button" accessibilityState={{ selected: active }}
              accessibilityLabel={`${weatherDateLabel(point.date)} ${point.date.slice(0, 4)}, ${forecast ? 'napoved' : 'pretekli modelski podatki'}, ${number(value, metric === 'rain' ? 'mm' : '°C')}`}
              onPress={() => onSelect(point.date)} style={[styles.day, { left: i * CELL, width: CELL, height: TOP + HEIGHT + bottom }, active && styles.selectedDay]}>
              {metric === 'rain' && value != null ? <View pointerEvents="none" style={[styles.bar, { left: CELL / 2 - 12, top: y(value), height: Math.max(2, TOP + HEIGHT - y(value)), backgroundColor: forecast ? colors.surfaceSoft : color, borderColor: color }]} /> : null}
              {metric === 'temperature' && point.temperatureMinC != null && point.temperatureMaxC != null && point.temperatureMaxC >= point.temperatureMinC ? <View pointerEvents="none" style={[styles.range, { left: CELL / 2 - 2, top: y(point.temperatureMaxC), height: Math.max(2, y(point.temperatureMinC) - y(point.temperatureMaxC)), backgroundColor: color }]} /> : null}
              {metric === 'temperature' ? [point.temperatureMinC, point.temperatureMaxC].map((v, index) => v == null ? null : <View key={index} pointerEvents="none" style={[styles.rangeCap, { left: CELL / 2 - 5, top: y(v), backgroundColor: color }]} />) : null}
              {metric === 'temperature' && value != null ? <View pointerEvents="none" style={[styles.dot, { left: CELL / 2 - 4, top: y(value) - 4, backgroundColor: forecast ? colors.surface : color, borderColor: color }]} /> : null}
              {value == null ? <Text style={[styles.missing, { left: CELL / 2 - 8, top: TOP + HEIGHT - 22 }]}>—</Text> : null}
              <Text style={[styles.date, { width: CELL, top: TOP + HEIGHT + 8 }]}>{weatherDateLabel(point.date)}</Text>
            </Pressable>;
          })}
        </View>
      </ScrollView>
    </View>
    <Text style={styles.secondary}>Povleci levo/desno · tapni dan za vrednosti</Text>
    <View style={styles.selection} accessibilityLiveRegion="polite">
      <Text style={styles.selectionTitle}>{weatherDateLabel(selected.date)} {selected.date.slice(0, 4)} · {phase}</Text>
      <Text style={styles.value}>{detail}</Text>
      {selected.stale ? <Text style={styles.secondary}>Starejši podatki iz predpomnilnika</Text> : null}
      {selected.fetchedAt ? <Text style={styles.secondary}>Pridobljeno: {new Date(selected.fetchedAt).toLocaleString('sl-SI', { timeZone: series.timezone })}</Text> : null}
    </View>
  </View>;
}
const styles = StyleSheet.create({ graphs: { gap: spacing.md }, chart: { gap: spacing.xs },
  heading: { fontSize: 16, fontWeight: '600', color: colors.primary }, secondary: { fontSize: 13, lineHeight: 18, color: colors.muted },
  legend: { fontSize: 13, color: colors.muted }, loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  plotRow: { flexDirection: 'row' }, axis: { width: 38 }, tick: { position: 'absolute', right: 4, fontSize: 12, color: colors.muted },
  plotScroll: { flexGrow: 0 }, day: { position: 'absolute', minHeight: 44 }, selectedDay: { backgroundColor: 'rgba(94,133,105,0.10)' },
  gridline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  todayBoundary: { position: 'absolute', borderLeftWidth: 1, borderStyle: 'dashed', borderColor: colors.accent },
  todayLabel: { position: 'absolute', top: 4, fontSize: 13, color: colors.accent },
  bar: { position: 'absolute', left: 10, width: 24, borderWidth: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  line: { position: 'absolute', height: 2 }, dot: { position: 'absolute', left: 18, width: 8, height: 8, borderWidth: 2, borderRadius: 4 },
  range: { position: 'absolute', left: 20, width: 4, opacity: .3 }, missing: { position: 'absolute', left: 16, fontSize: 16, color: colors.muted },
  rangeCap: { position: 'absolute', width: 10, height: 1, opacity: .5 },
  date: { position: 'absolute', textAlign: 'center', fontSize: 12, color: colors.muted },
  selection: { backgroundColor: colors.surfaceSoft, borderRadius: radii.sm, padding: spacing.sm, gap: spacing.xs },
  selectionTitle: { color: colors.primary, fontSize: 13, fontWeight: '600', lineHeight: 18 }, value: { fontSize: 14, lineHeight: 20, color: colors.text },
  retry: { minHeight: 44, justifyContent: 'center' } });
