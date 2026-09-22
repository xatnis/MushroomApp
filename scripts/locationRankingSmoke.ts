import { assessLocationWeather, rankingProfileForSpecies } from '../src/domain/locationRanking';
import { calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import type { MushroomWeatherProfileId, MushroomWeatherSummary } from '../src/domain/types';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const testPohorje: MushroomWeatherSummary = {
  latitude: 46.53,
  longitude: 15.60,
  current: {
    temperatureC: 17.2,
    soilMoisture0To7Cm: 0.351,
    soilMoisture7To28Cm: 0.357,
  },
  historical: {
    days: [],
    rain3dMm: 0,
    rain7dMm: 7.2,
    rain14dMm: 91,
    rain26dMm: 119,
    rain30dMm: 131,
    rain60dMm: 184,
    avgTemp7dC: 17.4,
    avgTemp14dC: 17.1,
    avgTemp20dC: 16.9,
    evapotranspiration7dMm: 14.4,
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
  updatedAt: '2026-09-22T08:00:00.000Z',
  stale: false,
  source: 'open-meteo',
};

const cases: Array<{ speciesId?: string; profileId: MushroomWeatherProfileId }> = [
  { profileId: 'generic' },
  { speciesId: 'boletus-edulis', profileId: 'boletusEdulis' },
  { speciesId: 'cantharellus-cibarius', profileId: 'cantharellusCibarius' },
  { speciesId: 'lactarius-deliciosus', profileId: 'lactariusDeliciosus' },
];

for (const testCase of cases) {
  const conditionsScore = calculateMushroomWeatherScore(testPohorje, testCase.profileId);
  const ranking = assessLocationWeather(testPohorje, testCase.speciesId);
  assert(ranking.profileId === testCase.profileId, `${testCase.profileId}: napačen profil`);
  assert(ranking.score.score === conditionsScore.score, `${testCase.profileId}: ranking in Conditions se ne ujemata`);
  assert(ranking.score.label === conditionsScore.label, `${testCase.profileId}: klasifikaciji se ne ujemata`);
  assert(ranking.dataQuality === 'complete', `${testCase.profileId}: popoln fixture mora biti complete`);
}

const genericConditions = calculateMushroomWeatherScore(testPohorje, 'generic');
const genericRanking = assessLocationWeather(testPohorje);
assert(genericConditions.score === 87, `Test pohorje fixture: pričakovan score 87, dobljen ${genericConditions.score}`);
assert(genericRanking.score.score === genericConditions.score, 'Test pohorje: Kam po gobe? mora biti enak Conditions');

for (const unsupported of ['boletus-aereus', 'macrolepiota-procera', 'craterellus-cornucopioides']) {
  const mapping = rankingProfileForSpecies(unsupported);
  assert(mapping.profileId === 'generic' && mapping.usesGenericFallback, `${unsupported}: pričakovan generic fallback`);
  assert(assessLocationWeather(testPohorje, unsupported).score.score === genericConditions.score, `${unsupported}: fallback mora ohraniti generic score`);
}

const withoutOptional: MushroomWeatherSummary = {
  ...testPohorje,
  current: { temperatureC: testPohorje.current?.temperatureC },
  historical: { ...testPohorje.historical!, evapotranspiration7dMm: undefined },
};
const limited = assessLocationWeather(withoutOptional);
assert(limited.score.score != null && Number.isFinite(limited.score.score), 'Missing optional podatki ne smejo ustvariti NaN');
assert(limited.dataQuality === 'limited', 'Missing soil/ET0 mora biti limited');

const insufficient = assessLocationWeather(undefined);
assert(insufficient.score.score == null && insufficient.dataQuality === 'insufficient', 'Missing core input mora biti insufficient');

console.log('Location ranking consistency smoke: OK');
console.log(`Test pohorje generic: Conditions=${genericConditions.score}, Kam po gobe=${genericRanking.score.score}`);
for (const testCase of cases) {
  const result = assessLocationWeather(testPohorje, testCase.speciesId);
  console.log(`${testCase.profileId}: ${result.score.score}/100 · ${result.score.label} · ${result.dataQuality}`);
}
