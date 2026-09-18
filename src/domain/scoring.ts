import type { ConditionsData, FindRecord, ScoreResult } from './types';

export const SCORE_CONFIG = {
  precipitation: { weight: 45, ideal3dMin: 8, ideal7dMin: 18, excessive7d: 90 },
  temperature: { weight: 30, broadIdealMin: 9, broadIdealMax: 21, hardMin: 1, hardMax: 30 },
  season: { weight: 10, strongMonths: [8, 9, 10] },
  personalHistory: { weight: 15, lookbackDays: 730 },
  meaningfulRainMmPerHour: 1,
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export function calculateMushroomScore(conditions: ConditionsData | undefined, history: FindRecord[], speciesId?: string): ScoreResult {
  if (!conditions || conditions.precipitation3dMm == null || conditions.precipitation7dMm == null || conditions.temperatureC == null) {
    return { label: 'Premalo podatkov', reasons: ['Za oceno potrebujemo temperaturo ter nedavne podatke o padavinah.'], coverage: 'Osnovni vremenski podatki niso popolni.' };
  }
  const reasons: string[] = [];
  const parts: Array<{ value: number; weight: number }> = [];
  const rain3 = conditions.precipitation3dMm;
  const rain7 = conditions.precipitation7dMm;
  const rainScore = clamp((rain3 / SCORE_CONFIG.precipitation.ideal3dMin + rain7 / SCORE_CONFIG.precipitation.ideal7dMin) / 2) *
    (rain7 > SCORE_CONFIG.precipitation.excessive7d ? 0.75 : 1);
  parts.push({ value: rainScore, weight: SCORE_CONFIG.precipitation.weight });
  reasons.push(rainScore >= 0.7 ? `V zadnjih 7 dneh je bilo ${rain7.toFixed(1)} mm padavin.` : `Nedavnih padavin je malo (${rain7.toFixed(1)} mm v 7 dneh).`);

  const temp = conditions.temperatureC;
  const { broadIdealMin, broadIdealMax, hardMin, hardMax } = SCORE_CONFIG.temperature;
  const tempScore = temp >= broadIdealMin && temp <= broadIdealMax ? 1 : temp < broadIdealMin
    ? clamp((temp - hardMin) / (broadIdealMin - hardMin))
    : clamp((hardMax - temp) / (hardMax - broadIdealMax));
  parts.push({ value: tempScore, weight: SCORE_CONFIG.temperature.weight });
  reasons.push(`Trenutna ocenjena temperatura je ${temp.toFixed(1)} °C.`);

  const month = new Date().getMonth() + 1;
  const seasonScore = SCORE_CONFIG.season.strongMonths.includes(month) ? 1 : [4, 5, 6, 7, 11].includes(month) ? 0.65 : 0.3;
  parts.push({ value: seasonScore, weight: SCORE_CONFIG.season.weight });

  const cutoff = Date.now() - SCORE_CONFIG.personalHistory.lookbackDays * 86400_000;
  const relevant = history.filter((find) => new Date(find.observedAt).getTime() >= cutoff && (!speciesId || find.items.some((item) => item.speciesId === speciesId)));
  if (relevant.length) {
    const success = relevant.filter((find) => find.outcome === 'found').length;
    const attempts = relevant.filter((find) => find.outcome !== 'unspecified').length;
    if (attempts) {
      parts.push({ value: success / attempts, weight: SCORE_CONFIG.personalHistory.weight });
      reasons.push(`Osebna zgodovina: ${success} uspešnih od ${attempts} primerljivih obiskov.`);
    }
  }
  const weighted = parts.reduce((sum, part) => sum + part.value * part.weight, 0) / parts.reduce((sum, part) => sum + part.weight, 0);
  const score = Math.round((weighted * 100) / 5) * 5;
  const label = score >= 75 ? 'Zelo obetavno' : score >= 55 ? 'Obetavno' : score >= 35 ? 'Mešane razmere' : 'Manj ugodno';
  return { score, label, reasons: reasons.slice(0, 3), coverage: relevant.length ? 'Vreme in osebna zgodovina' : 'Vreme in sezonski kontekst; brez kazni za manjkajočo zgodovino' };
}
