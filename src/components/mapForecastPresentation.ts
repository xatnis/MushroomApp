import { CANONICAL_POINT_POLICY, type SevenDayResult, type SevenDaySnapshot } from '../domain/sevenDayConditions';
import { HOURLY_INTERVAL_CONTRACT } from '../domain/weatherIntervals';
import { validWeatherDate, WEATHER_TIMEZONE } from '../domain/weatherSeries';
import { slNumber } from '../domain/format';
import { advancedFactors } from './conditionsAdvancedPresentation';

export const forecastDateLabel = (date: string) => validWeatherDate(date)
  ? new Intl.DateTimeFormat('sl-SI', { timeZone: WEATHER_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(date + 'T12:00:00Z')) : date;

/** Panel plus its existing bottom anchor may cover at most half the measured map. */
export const compactMapForecastHeight = (mapHeight: number, bottom: number) =>
  Number.isFinite(mapHeight) && mapHeight > 0 ? Math.max(0, mapHeight / 2 - Math.max(0, bottom)) : 0;

/** Readable text/48dp controls budget, not a device-specific screen size or native text measurement. */
export function compactForecastHasDateStrip(height: number, fontScale: number) {
  const scale = Math.max(1, fontScale);
  return height >= Math.max(48, 44 * scale) + Math.max(48, 34 * scale) + 58 * scale + 28 + Math.max(48, 20 * scale + 16);
}

/** Presentation only. Never compare different points, profiles, vintages or input contracts. */
export function forecastComparison(day?: SevenDayResult, today?: SevenDayResult, snapshot?: SevenDaySnapshot): string {
  const valid = (result?: SevenDayResult): result is SevenDayResult & { score: number } => !!result
    && (result.status === 'ready' || result.status === 'stale') && result.componentsVerified
    && result.score != null && Number.isFinite(result.score) && result.score >= 0 && result.score <= 100;
  if (!valid(day) || !valid(today) || !snapshot || snapshot.pointPolicyVersion !== CANONICAL_POINT_POLICY
    || snapshot.inputContract !== HOURLY_INTERVAL_CONTRACT || !snapshot.snapshotId
    || day.snapshotId !== snapshot.snapshotId || today.snapshotId !== snapshot.snapshotId
    || day.latitude !== snapshot.latitude || day.longitude !== snapshot.longitude
    || today.latitude !== day.latitude || today.longitude !== day.longitude || today.profileId !== day.profileId
    || today.targetLocalDate !== snapshot.baseLocalDate || today.horizonDay !== 0
    || day.forecastRetrievedAt !== today.forecastRetrievedAt || day.assembledAt !== today.assembledAt)
    return 'Primerjava z današnjim dnem ni na voljo.';
  const delta = day.score - today.score;
  if (delta === 0) return 'Enaka ocena kot danes';
  const amount = Math.abs(delta), mod = amount % 100;
  const unit = Number.isInteger(amount) ? mod === 1 ? 'točka' : mod === 2 ? 'točki' : mod === 3 || mod === 4 ? 'točke' : 'točk' : 'točke';
  return `${delta > 0 ? '+' : '−'}${slNumber(amount, Number.isInteger(amount) ? 0 : 1)} ${unit} glede na danes`;
}

/** Strongest/weakest normalized contributions describe this day, NOT causes of day-to-day change. */
export function forecastFactorInsights(day: SevenDayResult) {
  if (!day.componentsVerified) return [];
  const factors = advancedFactors(day.canonical).filter(f => f.ratio != null)
    .sort((a, b) => b.ratio! - a.ratio! || a.key.localeCompare(b.key));
  return factors.length > 1 ? [factors[0], factors[factors.length - 1]] : factors;
}
