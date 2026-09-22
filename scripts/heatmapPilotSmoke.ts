import { calculateMushroomWeatherScore } from '../src/domain/mushroomWeather';
import { assessHeatmapWeather, buildHeatmapWeatherSummary, heatmapDataQuality, localDateFor, targetLocalDate } from '../src/domain/heatmap/assessment';
import {
  areaAssessmentFor,
  habitatStateFor,
  HEATMAP_HABITAT,
  HEATMAP_PILOT_METADATA,
  HEATMAP_PROFILE_IDS,
  HEATMAP_TARGET_DAYS,
  PILOT_MIN_TREE_COVER_FRACTION,
} from '../src/domain/heatmap/pilot';
import type { HeatmapWeatherCellSource } from '../src/domain/heatmap/types';
import { createHeatmapRequestGate } from '../src/services/heatmap/pilotHeatmap';
import { shiftLocalDate } from '../src/services/weather';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const baseLocalDate = '2026-09-21';
const days = Array.from({ length: 62 }, (_, index) => {
  const offset = index - 60;
  const date = shiftLocalDate(baseLocalDate, offset);
  return {
    date,
    kind: offset < 0 ? 'historical' as const : 'forecast' as const,
    precipitationMm: offset === 0 ? 9 : 2,
    temperatureMeanC: offset === 0 ? 13 : 14,
    temperatureMinC: 9,
    temperatureMaxC: 18,
    evapotranspirationMm: 1,
    weatherCode: 2,
  };
});

const source: HeatmapWeatherCellSource = {
  id: HEATMAP_PILOT_METADATA.weatherCells[0].id,
  latitude: HEATMAP_PILOT_METADATA.weatherCells[0].latitude,
  longitude: HEATMAP_PILOT_METADATA.weatherCells[0].longitude,
  baseLocalDate,
  days,
  currentSoil: { time: `${baseLocalDate}T12:00`, soilMoisture0To7Cm: 0.24, soilMoisture7To28Cm: 0.26 },
  tomorrowMorningSoil: { time: `${shiftLocalDate(baseLocalDate, 1)}T09:00`, soilMoisture0To7Cm: 0.25, soilMoisture7To28Cm: 0.27 },
  errors: {},
  fetchedAt: '2026-09-21T10:00:00.000Z',
  stale: false,
};

assert(targetLocalDate(baseLocalDate, 'today') === '2026-09-21', 'Today target date shifted unexpectedly.');
assert(targetLocalDate(baseLocalDate, 'tomorrow') === '2026-09-22', 'Tomorrow target date is incorrect.');
assert(localDateFor(new Date('2026-09-21T22:30:00.000Z')) === '2026-09-22', 'Pilot date must follow Europe/Ljubljana, not device UTC date.');

const today = buildHeatmapWeatherSummary(source, 'today');
const tomorrow = buildHeatmapWeatherSummary(source, 'tomorrow');
assert(today.modelledHistoryDays === 0, 'Today must not include future/modelled days in history.');
assert(tomorrow.modelledHistoryDays === 1, 'Tomorrow must include exactly today as a modelled historical day.');
assert(today.summary.historical?.rain7dMm === 14, `Today rain7 expected 14, got ${today.summary.historical?.rain7dMm}.`);
assert(tomorrow.summary.historical?.rain7dMm === 21, `Tomorrow shifted rain7 expected 21, got ${tomorrow.summary.historical?.rain7dMm}.`);
assert(tomorrow.summary.current?.time === '2026-09-22T09:00', 'Tomorrow soil convention must use approximately 09:00 local time.');

HEATMAP_TARGET_DAYS.forEach((targetDay) => HEATMAP_PROFILE_IDS.forEach((profileId) => {
  const assessment = assessHeatmapWeather(source, profileId, targetDay);
  const direct = calculateMushroomWeatherScore(assessment.summary, profileId);
  assert(assessment.score.score === direct.score, `${profileId}/${targetDay} did not reuse the existing scorer.`);
  assert(assessment.dataQuality === 'complete', `${profileId}/${targetDay} fixture should be complete.`);
}));

const changedFuture: HeatmapWeatherCellSource = {
  ...source,
  days: source.days.map((day) => day.date > baseLocalDate ? { ...day, precipitationMm: 200 } : day),
};
HEATMAP_PROFILE_IDS.forEach((profileId) => {
  const original = assessHeatmapWeather(source, profileId, 'today').score.score;
  const changed = assessHeatmapWeather(changedFuture, profileId, 'today').score.score;
  assert(original === changed, `Future rain changed today's ${profileId} score.`);
});

const noSoil = { ...source, currentSoil: undefined };
assert(assessHeatmapWeather(noSoil, 'boletusEdulis', 'today').dataQuality === 'limited', 'Missing optional soil must be limited.');
assert(heatmapDataQuality('generic', ['soilMoisture'], 50) === 'insufficient', 'Missing core inputs must be insufficient.');

const treeFeature = HEATMAP_HABITAT.features.find((feature) => feature.properties.treeCoverFraction >= PILOT_MIN_TREE_COVER_FRACTION);
const openFeature = HEATMAP_HABITAT.features.find((feature) => feature.properties.treeCoverFraction < PILOT_MIN_TREE_COVER_FRACTION);
assert(treeFeature && openFeature, 'Pilot artifact must contain both wooded and more open cells.');
assert(habitatStateFor(treeFeature, 'boletusEdulis') === 'candidate', 'Wooded Boletus cell must be candidate.');
assert(habitatStateFor(treeFeature, 'cantharellusCibarius') === 'candidate', 'Wooded Chanterelle cell must be candidate.');
assert(habitatStateFor(openFeature, 'boletusEdulis') === 'outside-model', 'Open Boletus cell must be outside-model.');
assert(habitatStateFor({ ...treeFeature, properties: { ...treeFeature.properties, zgs: undefined } }, 'lactariusDeliciosus') === 'unknown', 'WorldCover-only Lactarius cell must remain unknown.');

const weatherIds = new Set(HEATMAP_PILOT_METADATA.weatherCells.map((cell) => cell.id));
assert(HEATMAP_HABITAT.features.every((feature) => weatherIds.has(feature.properties.weatherCellId)), 'Every habitat area must map to a real pilot weather cell.');
const areaAssessment = areaAssessmentFor(treeFeature, assessHeatmapWeather(source, 'boletusEdulis', 'today'));
assert(areaAssessment.areaId === treeFeature.properties.id, 'Area assessment lost its source area ID.');

const gate = createHeatmapRequestGate();
const oldRequest = gate.next();
const newRequest = gate.next();
assert(!gate.isCurrent(oldRequest) && gate.isCurrent(newRequest), 'Stale request protection does not reject an older response.');
gate.invalidate();
assert(!gate.isCurrent(newRequest), 'Unmount/invalidation must reject the previously current response.');

console.info('Heatmap Pilot smoke tests passed', {
  habitatAreas: HEATMAP_PILOT_METADATA.habitatPolygonCount,
  weatherCells: HEATMAP_PILOT_METADATA.weatherCellCount,
  todayRain7: today.summary.historical?.rain7dMm,
  tomorrowRain7: tomorrow.summary.historical?.rain7dMm,
  profiles: HEATMAP_PROFILE_IDS,
});
