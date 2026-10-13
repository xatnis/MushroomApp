import type { MushroomConditionsScore, MushroomScoreComponent, MushroomWeatherSummary } from '../domain/types';
import { BOLETUS_EDULIS_SCORE_V1_CONFIG, CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG, MUSHROOM_SCORE_V1_CONFIG } from '../domain/mushroomWeather';
import { factorBand } from '../domain/heatmap/cardPresentation';
import { slNumber } from '../domain/format';

const configs = { generic: MUSHROOM_SCORE_V1_CONFIG, boletusEdulis: BOLETUS_EDULIS_SCORE_V1_CONFIG,
  cantharellusCibarius: CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG, lactariusDeliciosus: LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG };
const names: Record<MushroomScoreComponent['key'], string> = {
  rain: 'Pretekle padavine', rain7: 'Nedavne padavine (7 dni)', rain14: 'Nedavne padavine (14 dni)',
  rain26: 'Padavine (26 dni)', rain30: 'Padavine (30 dni)', rain60: 'Padavine (60 dni)',
  temperature: 'Temperatura', soilMoisture: 'Vlaga tal 0–28 cm', drying: 'Bilanca izsuševanja',
};

// Presentation only: never recalculate the total or infer points from the final score.
export function advancedFactors(score: MushroomConditionsScore) {
  const expected = Object.keys(configs[score.profile].componentWeights) as MushroomScoreComponent['key'][];
  const keys = [...new Set([...expected, ...score.components.map(c => c.key)])];
  return keys.map(key => {
    const c = score.components.find(component => component.key === key);
    const numeric = c != null && Number.isFinite(c.weightedPoints) && Number.isFinite(c.weight)
      && c.weight > 0 && c.weightedPoints >= 0 && c.weightedPoints <= c.weight;
    const ratio = numeric ? c.weightedPoints / c.weight : undefined;
    const band = factorBand(ratio); // Same existing display bands as conditions details, not new biological thresholds.
    return { key, label: c?.label ?? (key === 'temperature' ? `Temperatura (${score.profile === 'cantharellusCibarius' ? 14 : 20} dni)` : names[key]),
      points: numeric ? c.weightedPoints : undefined, maximum: numeric ? c.weight : undefined, ratio,
      contribution: numeric ? `${slNumber(c.weightedPoints, 1)} / ${slNumber(c.weight, 1)}` : 'Ni podatka',
      status: band < 0 ? 'Prispevek ni na voljo.' : ['Manj ugoden signal', 'Zmerno ugoden signal', 'Ugoden signal', 'Zelo ugoden signal'][band],
    };
  });
}

const value = (n: number | undefined, unit: string, digits = 1) =>
  n == null || !Number.isFinite(n) ? 'Ni podatka' : `${slNumber(n, digits)} ${unit}`;

export function advancedInputs(summary: MushroomWeatherSummary, score: MushroomConditionsScore) {
  const h = summary.historical, c = summary.current;
  const profile = score.profile;
  const rainWindows = profile === 'generic' ? [7, 14, 30] : profile === 'boletusEdulis' ? [26]
    : profile === 'cantharellusCibarius' ? [7, 30] : [14, 60];
  const temperatureDays = profile === 'cantharellusCibarius' ? 14 : 20;
  // The dependency map describes the inspected production inputs; it does not evaluate them.
  // Only a value consumed by an existing canonical component is labelled as used.
  const used = (n: number | undefined, ...keys: MushroomScoreComponent['key'][]) =>
    n != null && Number.isFinite(n) && score.components.some(component => keys.includes(component.key));
  return [
    { title: 'Padavine', rows: ([3, 7, 14, 26, 30, 60] as const).map(days => ({
      label: `Padavine zadnjih ${days} dni`, value: value(h?.[`rain${days}dMm`], 'mm'),
      usage: rainWindows.includes(days) ? `Vhod padavinskega signala${days === 7 ? ' in bilance izsuševanja' : ''}` : days === 7 ? 'Vhod bilance izsuševanja' : 'Dodaten vremenski kontekst',
      coverage: h?.coverage?.[`rain${days}dDays`] == null ? undefined : `${h.coverage[`rain${days}dDays`]}/${days} dni`,
      usedInScore: used(h?.[`rain${days}dMm`], ...(rainWindows.includes(days) ? [profile === 'generic' ? 'rain' as const : `rain${days}` as MushroomScoreComponent['key']] : []), ...(days === 7 ? ['drying' as const] : [])),
    })) },
    { title: 'Temperatura', rows: ([7, 14, 20] as const).map(days => ({
      label: `Povprečna temperatura ${days} dni`, value: value(h?.[`avgTemp${days}dC`], '°C'),
      usage: days === temperatureDays ? 'Vhod temperaturnega signala' : 'Dodaten vremenski kontekst',
      coverage: h?.coverage?.[`temp${days}dDays`] == null ? undefined : `${h.coverage[`temp${days}dDays`]}/${days} dni`,
      usedInScore: days === temperatureDays && used(h?.[`avgTemp${days}dC`], 'temperature'),
    })) },
    { title: 'Vlaga tal', rows: [
      { label: 'Modelirana vlaga tal 0–7 cm', value: value(c?.soilMoisture0To7Cm, 'm³/m³', 3), usage: 'Vhod talne vlage', coverage: undefined, usedInScore: used(c?.soilMoisture0To7Cm, 'soilMoisture') },
      { label: 'Modelirana vlaga tal 7–28 cm', value: value(c?.soilMoisture7To28Cm, 'm³/m³', 3), usage: 'Vhod talne vlage', coverage: undefined, usedInScore: used(c?.soilMoisture7To28Cm, 'soilMoisture') },
    ] },
    { title: 'Izsuševanje', rows: [
      { label: 'ET₀ zadnjih 7 dni', value: value(h?.evapotranspiration7dMm, 'mm ET₀'), usage: 'Bilanca s padavinami zadnjih 7 dni',
        coverage: h?.coverage?.evapotranspiration7dDays == null ? undefined : `${h.coverage.evapotranspiration7dDays}/7 dni`, usedInScore: used(h?.evapotranspiration7dMm, 'drying') },
    ] },
  ];
}

export function advancedInputGroups(summary: MushroomWeatherSummary, score: MushroomConditionsScore) {
  const groups = advancedInputs(summary, score);
  const select = (used: boolean) => groups.map(group => ({ ...group, rows: group.rows.filter(row => row.usedInScore === used) })).filter(group => group.rows.length);
  return { used: select(true), additional: select(false) };
}

export function advancedExplanation(score: MushroomConditionsScore): string {
  if (score.score == null) return score.reasons[0] ?? 'Za oceno ni dovolj podatkov.';
  const factors = advancedFactors(score);
  const available = factors.filter(factor => factor.points != null);
  if (!available.length) return score.reasons[0] ?? 'Numerični prispevki niso na voljo.';
  // Describe actual weighted contributions, never reverse-engineer the total or add thresholds.
  const largest = available.reduce((first, next) => next.points! > first.points! ? next : first);
  const text = largest.points === 0 ? 'Razpoložljivi dejavniki ne prispevajo točk.' : `K oceni največ prispeva dejavnik »${largest.label}«.`;
  return text + (available.length < factors.length ? ' Del prispevkov ni na voljo.' : '');
}
