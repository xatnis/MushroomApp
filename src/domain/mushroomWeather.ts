import type { MushroomConditionsScore, MushroomScoreComponent, MushroomWeatherSummary } from './types';

// Experimental V1 constants for the generic mushroom profile.
// They are transparent tuning inputs, not scientifically validated prediction thresholds.
export const MUSHROOM_SCORE_V1_CONFIG = {
  profile: 'generic',
  componentWeights: { rain: 45, temperature: 25, soilMoisture: 20, drying: 10 },
  rain: {
    targetsMm: { days7: 35, days14: 60, days30: 100 },
    horizonWeights: { days7: 0.20, days14: 0.35, days30: 0.45 },
  },
  temperature: { optimumC: 14, standardDeviationC: 6.5 },
  soilMoisture: { baselineM3M3: 0.12, rangeM3M3: 0.16, layerWeights: { top0To7Cm: 0.40, lower7To28Cm: 0.60 } },
  drying: { fullDeficitMm: 20 },
  futureRain: { improving7dMm: 25, dry7dMm: 3 },
  thresholds: { average: 25, good: 50, veryGood: 70, excellent: 85 },
} as const;

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const scoreLabel = (score: number) => {
  const { average, good, veryGood, excellent } = MUSHROOM_SCORE_V1_CONFIG.thresholds;
  if (score >= excellent) return 'Odlične razmere';
  if (score >= veryGood) return 'Zelo dobre razmere';
  if (score >= good) return 'Dobre razmere';
  if (score >= average) return 'Povprečne razmere';
  return 'Slabe razmere';
};

const addComponent = (components: MushroomScoreComponent[], component: Omit<MushroomScoreComponent, 'weightedPoints'>) => {
  components.push({ ...component, weightedPoints: component.value * component.weight });
};

export function calculateMushroomWeatherScore(summary?: MushroomWeatherSummary): MushroomConditionsScore {
  const historical = summary?.historical;
  const forecast = summary?.forecast;
  const components: MushroomScoreComponent[] = [];
  const rain7d = historical?.rain7dMm;
  const rain14d = historical?.rain14dMm;
  const rain30d = historical?.rain30dMm;
  const avgTemp20d = historical?.avgTemp20dC;
  const soil0To7 = summary?.current?.soilMoisture0To7Cm;
  const soil7To28 = summary?.current?.soilMoisture7To28Cm;
  const evapotranspiration7d = historical?.evapotranspiration7dMm;
  const futureRain7d = forecast?.rain7dMm;

  if (rain7d != null && rain14d != null && rain30d != null) {
    const rainConfig = MUSHROOM_SCORE_V1_CONFIG.rain;
    const r7 = clamp(rain7d / rainConfig.targetsMm.days7);
    const r14 = clamp(rain14d / rainConfig.targetsMm.days14);
    const r30 = clamp(rain30d / rainConfig.targetsMm.days30);
    const value = rainConfig.horizonWeights.days7 * r7
      + rainConfig.horizonWeights.days14 * r14
      + rainConfig.horizonWeights.days30 * r30;
    addComponent(components, { key: 'rain', label: 'Pretekle padavine', value, weight: MUSHROOM_SCORE_V1_CONFIG.componentWeights.rain });
  }

  if (avgTemp20d != null) {
    const { optimumC, standardDeviationC } = MUSHROOM_SCORE_V1_CONFIG.temperature;
    const value = Math.exp(-((avgTemp20d - optimumC) ** 2) / (2 * standardDeviationC ** 2));
    addComponent(components, { key: 'temperature', label: 'Temperatura (20 dni)', value, weight: MUSHROOM_SCORE_V1_CONFIG.componentWeights.temperature });
  }

  if (soil0To7 != null && soil7To28 != null) {
    const soilConfig = MUSHROOM_SCORE_V1_CONFIG.soilMoisture;
    const moistureNorm = (value: number) => clamp((value - soilConfig.baselineM3M3) / soilConfig.rangeM3M3);
    const value = soilConfig.layerWeights.top0To7Cm * moistureNorm(soil0To7)
      + soilConfig.layerWeights.lower7To28Cm * moistureNorm(soil7To28);
    addComponent(components, { key: 'soilMoisture', label: 'Vlaga tal 0–28 cm', value, weight: MUSHROOM_SCORE_V1_CONFIG.componentWeights.soilMoisture });
  }

  let dryingDeficit: number | undefined;
  if (evapotranspiration7d != null && rain7d != null) {
    dryingDeficit = Math.max(evapotranspiration7d - rain7d, 0);
    const value = 1 - clamp(dryingDeficit / MUSHROOM_SCORE_V1_CONFIG.drying.fullDeficitMm);
    addComponent(components, { key: 'drying', label: 'Bilanca izsuševanja', value, weight: MUSHROOM_SCORE_V1_CONFIG.componentWeights.drying });
  }

  const hasRain = components.some((component) => component.key === 'rain');
  const hasTemperature = components.some((component) => component.key === 'temperature');
  if (!hasRain || !hasTemperature) {
    return {
      profile: 'generic', score: undefined, label: 'Premalo podatkov', trend: 'Ni dovolj podatkov', components,
      reasons: ['Za eksperimentalno oceno potrebujemo 7/14/30-dnevne padavine in 20-dnevno povprečno temperaturo.'],
      coverage: 'Del vremenskih podatkov manjka.',
    };
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const score = Math.round(components.reduce((sum, component) => sum + component.weightedPoints, 0) / totalWeight * 100);
  const dryingSignal = components.find((component) => component.key === 'drying')?.value;
  const trend: MushroomConditionsScore['trend'] = futureRain7d != null
    && futureRain7d >= MUSHROOM_SCORE_V1_CONFIG.futureRain.improving7dMm
    && (rain7d == null || futureRain7d > rain7d)
    ? 'Izboljšanje'
    : futureRain7d != null && futureRain7d <= MUSHROOM_SCORE_V1_CONFIG.futureRain.dry7dMm
      && dryingSignal != null && dryingSignal < 0.5
      ? 'Slabšanje'
      : 'Stabilno';

  const reasons: string[] = [];
  if (rain14d != null) reasons.push(`V zadnjih 14 dneh je bilo ${rain14d.toFixed(1)} mm padavin.`);
  if (avgTemp20d != null) reasons.push(`Povprečna temperatura zadnjih 20 dni je ${avgTemp20d.toFixed(1)} °C.`);
  if (soil0To7 != null && soil7To28 != null) reasons.push(`Modelirana vlaga tal je ${soil0To7.toFixed(3)} m³/m³ v plasti 0–7 cm in ${soil7To28.toFixed(3)} m³/m³ v plasti 7–28 cm.`);
  if (dryingDeficit != null) reasons.push(`Sedemdnevni primanjkljaj padavin glede na ET₀ je ${dryingDeficit.toFixed(1)} mm.`);
  if (trend === 'Izboljšanje' && futureRain7d != null) reasons.push(`Napovedanih ${futureRain7d.toFixed(1)} mm padavin vpliva samo na trend, ne na današnji score.`);
  if (trend === 'Slabšanje') reasons.push('Suha napoved in trenutna bilanca izsuševanja kažeta možnost slabšanja pogojev.');

  return {
    profile: 'generic', score, label: scoreLabel(score), trend, components, reasons: reasons.slice(0, 5),
    coverage: components.length === 4 ? 'Padavine, 20-dnevna temperatura, dve plasti vlage tal in bilanca izsuševanja' : 'Ocena uporablja razpoložljive današnje signale; manjkajoča komponenta ni kaznovana.',
  };
}
