import { strictEqual, ok } from 'node:assert';
import { sevenDayFixture } from './sevenDayFixture';
import { sampleNativeSoil } from '../src/domain/soilSampling';
import { forecastSoilAt } from '../src/services/sevenDayConditions';
import { MUSHROOM_WEATHER_PROFILES, calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import type { MushroomWeatherProfileId } from '../src/domain/types';

const date = '2026-10-14', fixture = sevenDayFixture(date);
const time = Array.from({ length: 24 }, (_, i) => date + 'T' + String(i).padStart(2, '0') + ':00');
const data = { utc_offset_seconds: 7200, hourly_units: { soil_moisture_0_to_7cm: 'm³/m³', soil_moisture_7_to_28cm: 'm³/m³' },
  hourly: { time, soil_moisture_0_to_7cm: time.map((_, i) => .13 + i * .004), soil_moisture_7_to_28cm: time.map((_, i) => .18 + i * .003) } };
let inputsChanged = 0, scoresChanged = 0, maxDelta = 0, comparisons = 0;
for (let hour = 0; hour < 24; hour++) for (const minute of ['00', '15', '30', '45']) {
  const reference = date + 'T' + String(hour).padStart(2, '0') + ':' + minute;
  const floor = sampleNativeSoil(data, date, { kind: 'current', providerReference: reference }).point!;
  const nearest = forecastSoilAt(data, date, reference)!;
  for (const profile of Object.keys(MUSHROOM_WEATHER_PROFILES) as MushroomWeatherProfileId[]) {
    comparisons++;
    const asOf = calculateMushroomWeatherScore({ ...fixture.today, current: floor }, profile);
    const legacy = calculateMushroomWeatherScore({ ...fixture.today, current: nearest }, profile);
    if (floor.time !== nearest.time) { inputsChanged++; ok(nearest.time > reference, 'nearest is a future hour on the affected cases'); }
    const delta = Math.abs(asOf.score! - legacy.score!); if (delta) scoresChanged++; maxDelta = Math.max(maxDelta, delta);
    if (minute !== '45' || hour === 23) strictEqual(asOf.score, legacy.score, 'exact/floor/tie or final daily hour unchanged');
  }
}
strictEqual(comparisons, 384); strictEqual(inputsChanged, 92); ok(scoresChanged > 0 && maxDelta > 0);
console.log('Sampling policy impact audit: SYNTHETIC native-layer hourly gradient, not changed production outputs', { comparisons, inputsChanged, scoresChanged, maxDelta, productionChanges: 0 });
