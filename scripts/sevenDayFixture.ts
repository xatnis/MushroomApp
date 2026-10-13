import type { SevenDaySnapshot } from '../src/domain/sevenDayConditions';
import { buildHistoricalWeatherSummaryForTarget, shiftLocalDate } from '../src/services/weather';
export function sevenDayFixture(baseLocalDate = '2026-10-13'): SevenDaySnapshot {
  const daily = Array.from({ length: 67 }, (_, index) => {
    const offset = index - 60, date = shiftLocalDate(baseLocalDate, offset);
    return { day: { date, kind: offset < 0 ? 'historical' as const : 'forecast' as const,
      precipitationMm: offset < 0 ? 1 + index % 3 : (offset + 1) * 5,
      temperatureMeanC: offset < 0 ? 11 + index % 4 : 15 + offset,
      temperatureMinC: 6, temperatureMaxC: 20, evapotranspirationMm: 2 },
      source: offset < -7 ? 'archive' as const : offset < 0 ? 'recentForecastHistory' as const : 'forecast' as const,
      fetchedAt: '2026-10-13T08:00:00Z', stale: false };
  });
  const soilByDate = Object.fromEntries(Array.from({ length: 7 }, (_, i) => {
    const date = shiftLocalDate(baseLocalDate, i);
    return [date, { time: `${date}T${i ? '09' : '10'}:00`, soilMoisture0To7Cm: .2 + i / 100, soilMoisture7To28Cm: .25 + i / 100 }];
  }));
  return { baseLocalDate, latitude: 46.5, longitude: 14.5, timezone: 'Europe/Ljubljana', daily, soilByDate,
    today: { latitude: 46.5, longitude: 14.5, historical: buildHistoricalWeatherSummaryForTarget(daily.filter(e => e.day.date < baseLocalDate).map(e => e.day), baseLocalDate),
      current: { ...soilByDate[baseLocalDate], temperatureC: 15 }, forecast: { days: daily.filter(e => e.day.date >= baseLocalDate).map(e => e.day), rain7dMm: 140 },
      errors: {}, source: 'open-meteo', stale: false, updatedAt: '2026-10-13T08:00:00Z' }, legacyCurrentSoil: soilByDate[baseLocalDate],
    forecastRetrievedAt: '2026-10-13T08:00:00Z', archiveRetrievedAt: '2026-10-13T07:00:00Z', forecastIssuedAt: null,
    snapshotId: 'fixture-native-soil-v1', assembledAt: '2026-10-13T08:01:00Z', expiresAt: Date.now() + 1800000, stale: false, blockers: [] };
}
