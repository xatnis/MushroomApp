import { calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import { buildGenericWeatherDetails } from '../src/domain/weatherDetails';
import { slNumber } from '../src/domain/format';
import type { MushroomWeatherProfileId, MushroomWeatherSummary } from '../src/domain/types';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const summary: MushroomWeatherSummary = {
  latitude: 46.55,
  longitude: 15.65,
  current: {
    temperatureC: 18,
    soilMoisture0To7Cm: 0.372,
    soilMoisture7To28Cm: 0.370,
  },
  historical: {
    days: [],
    rain3dMm: 0,
    rain7dMm: 14.1,
    rain14dMm: 91.1,
    rain26dMm: 120,
    rain30dMm: 131.2,
    rain60dMm: 180,
    avgTemp7dC: 18.2,
    avgTemp14dC: 16.8,
    avgTemp20dC: 17.1,
    evapotranspiration7dMm: 16.5,
    coverage: {
      rain3dDays: 3,
      rain7dDays: 7,
      rain14dDays: 14,
      rain26dDays: 26,
      rain30dDays: 30,
      rain60dDays: 60,
      temp7dDays: 7,
      temp14dDays: 14,
      temp20dDays: 20,
      evapotranspiration7dDays: 7,
    },
  },
  forecast: { days: [], rain3dMm: 0, rain7dMm: 0 },
  errors: {},
  updatedAt: '2026-09-21T12:00:00.000Z',
  stale: false,
  source: 'open-meteo',
};

const profiles: MushroomWeatherProfileId[] = ['generic', 'boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus'];
const expectedScores: Record<MushroomWeatherProfileId, number> = {
  generic: 91,
  boletusEdulis: 89,
  cantharellusCibarius: 95,
  lactariusDeliciosus: 90,
};

const scores = Object.fromEntries(profiles.map((profile) => [profile, calculateMushroomWeatherScore(summary, profile)])) as Record<MushroomWeatherProfileId, ReturnType<typeof calculateMushroomWeatherScore>>;
profiles.forEach((profile) => assert(scores[profile].score === expectedScores[profile], `${profile} score changed: ${scores[profile].score}`));

const details = buildGenericWeatherDetails(summary, scores.generic);
const serialized = JSON.stringify(details);
['rain3d', 'rain7d', 'rain14d', 'rain30d', 'avgTemp7d', 'avgTemp14d', 'avgTemp20d', 'soilMoisture', 'futureRain3d', 'futureRain7d', '× utež']
  .forEach((rawName) => assert(!serialized.includes(rawName), `Raw/developer label leaked into details: ${rawName}`));
assert(serialized.includes('14,1 mm'), 'Rain must use a Slovenian decimal comma.');
assert(serialized.includes('17,1 °C'), 'Temperature must use a Slovenian decimal comma.');
assert(serialized.includes('0,372 m³/m³'), 'Soil moisture must use three decimal places with a Slovenian decimal comma.');
assert(serialized.includes('39,6 / 45'), 'Generic rainfall contribution is not presented correctly.');
assert(details.trendRows.every((row) => row.value === '0 mm'), 'Zero future rain must be shown as 0 mm.');
assert(details.coverage === 'Podatki: popolna 30-dnevna vremenska zgodovina.', 'Full history coverage copy is incorrect.');

const missingSoil: MushroomWeatherSummary = { ...summary, current: { temperatureC: 18 } };
const missingSoilScore = calculateMushroomWeatherScore(missingSoil, 'generic');
const missingSoilDetails = buildGenericWeatherDetails(missingSoil, missingSoilScore);
assert(missingSoilScore.score === 88, `Missing-soil renormalization changed: ${missingSoilScore.score}`);
assert(JSON.stringify(missingSoilDetails).includes('ni podatka / 20'), 'Missing soil must be visible without breaking details.');

const { evapotranspiration7dMm: _removedEt0, ...historyWithoutEt0 } = summary.historical!;
const missingEt0: MushroomWeatherSummary = { ...summary, historical: historyWithoutEt0 };
const missingEt0Score = calculateMushroomWeatherScore(missingEt0, 'generic');
const missingEt0Details = buildGenericWeatherDetails(missingEt0, missingEt0Score);
assert(missingEt0Score.score === 91, `Missing-ET0 renormalization changed: ${missingEt0Score.score}`);
assert(JSON.stringify(missingEt0Details).includes('ni podatka / 10'), 'Missing ET0 must be visible without breaking details.');

const partialHistory: MushroomWeatherSummary = {
  ...summary,
  historical: {
    ...summary.historical!,
    coverage: { ...summary.historical!.coverage, rain30dDays: 27, temp20dDays: 19 },
  },
};
const partialDetails = buildGenericWeatherDetails(partialHistory, calculateMushroomWeatherScore(partialHistory, 'generic'));
assert(partialDetails.coverage.startsWith('Podatki so delno omejeni.'), 'Partial coverage copy is incorrect.');

const wetForecast: MushroomWeatherSummary = { ...summary, forecast: { days: [], rain3dMm: 50, rain7dMm: 100 } };
profiles.forEach((profile) => {
  const wetScore = calculateMushroomWeatherScore(wetForecast, profile).score;
  assert(wetScore === scores[profile].score, `Future rain changed today's ${profile} score.`);
});

assert(slNumber(14.1) === '14,1', 'Slovenian number formatter does not use a decimal comma.');
console.info('Generic weather details regression passed:', Object.fromEntries(profiles.map((profile) => [profile, scores[profile].score])));
