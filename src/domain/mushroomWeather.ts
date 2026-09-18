import type {
  MushroomConditionsScore,
  MushroomScoreComponent,
  MushroomWeatherProfileId,
  MushroomWeatherSummary,
} from './types';

// Experimental V2 constants for the generic mushroom profile.
// They are transparent tuning inputs, not scientifically validated prediction thresholds.
// Keep these values unchanged: existing "Splošno" results depend on them.
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

// The 20-day temperature and 26-day rainfall windows are research-supported inputs for
// Boletus edulis. Weights, sigma and normalization references remain experimental tuning constants.
export const BOLETUS_EDULIS_SCORE_V1_CONFIG = {
  profile: 'boletusEdulis',
  speciesId: 'boletus-edulis',
  label: 'Jesenski goban',
  scientificName: 'Boletus edulis',
  componentWeights: { rain26: 50, temperature: 30, soilMoisture: 15, drying: 5 },
  rain: { fullSignalMm: 100 },
  temperature: { optimumC: 13, standardDeviationC: 4.5 },
  soilMoisture: {
    baselineM3M3: MUSHROOM_SCORE_V1_CONFIG.soilMoisture.baselineM3M3,
    rangeM3M3: MUSHROOM_SCORE_V1_CONFIG.soilMoisture.rangeM3M3,
    layerWeights: MUSHROOM_SCORE_V1_CONFIG.soilMoisture.layerWeights,
  },
  drying: { fullDeficitMm: MUSHROOM_SCORE_V1_CONFIG.drying.fullDeficitMm },
  thresholds: { average: 30, good: 50, veryGood: 70, excellent: 85 },
} as const;

// Research motivates the selected rainfall and temperature windows for Cantharellus cibarius.
// Exact weights, full-signal references, Gaussian center/sigma and scaling remain V1 tuning constants.
export const CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG = {
  profile: 'cantharellusCibarius',
  speciesId: 'cantharellus-cibarius',
  label: 'Navadna lisička',
  scientificName: 'Cantharellus cibarius',
  componentWeights: { rain30: 40, rain7: 10, temperature: 25, soilMoisture: 20, drying: 5 },
  rain: { days30FullSignalMm: 100, days7FullSignalMm: 25 },
  temperature: { referenceC: 17.5, standardDeviationC: 6.0, researchContextMinC: 15, researchContextMaxC: 20 },
  soilMoisture: {
    baselineM3M3: MUSHROOM_SCORE_V1_CONFIG.soilMoisture.baselineM3M3,
    rangeM3M3: MUSHROOM_SCORE_V1_CONFIG.soilMoisture.rangeM3M3,
    layerWeights: MUSHROOM_SCORE_V1_CONFIG.soilMoisture.layerWeights,
  },
  drying: { fullDeficitMm: MUSHROOM_SCORE_V1_CONFIG.drying.fullDeficitMm },
  thresholds: { average: 30, good: 50, veryGood: 70, excellent: 85 },
} as const;

// Research supports longer rainfall context, moisture and temperature as relevant inputs for
// Lactarius deliciosus. Windows, weights, exponential scales and temperature breakpoints below
// are experimental V1 tuning constants, not validated biological optima or universal limits.
export const LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG = {
  profile: 'lactariusDeliciosus',
  speciesId: 'lactarius-deliciosus',
  label: 'Užitna sirovka',
  scientificName: 'Lactarius deliciosus',
  componentWeights: { rain60: 35, rain14: 10, soilMoisture: 25, temperature: 25, drying: 5 },
  rain: { days60ScaleMm: 100, days14ScaleMm: 20 },
  temperature: { coldFloorC: 3, fullColdSupportC: 8, heatPenaltyStartC: 16, heatPenaltyEndC: 24 },
  soilMoisture: {
    baselineM3M3: MUSHROOM_SCORE_V1_CONFIG.soilMoisture.baselineM3M3,
    rangeM3M3: MUSHROOM_SCORE_V1_CONFIG.soilMoisture.rangeM3M3,
    layerWeights: MUSHROOM_SCORE_V1_CONFIG.soilMoisture.layerWeights,
  },
  drying: { fullDeficitMm: MUSHROOM_SCORE_V1_CONFIG.drying.fullDeficitMm },
  thresholds: { average: 30, good: 50, veryGood: 70, excellent: 85 },
} as const;

export interface MushroomWeatherProfileDefinition {
  id: MushroomWeatherProfileId;
  label: string;
  scientificName?: string;
  speciesId?: string;
  scoreTitle: string;
  scoreCaption: string;
  forecastNote: string;
  seasonNote?: string;
  evidenceNote: string;
  tuningNote: string;
  calculate: (summary?: MushroomWeatherSummary) => MushroomConditionsScore;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const genericScoreLabel = (score: number) => {
  const { average, good, veryGood, excellent } = MUSHROOM_SCORE_V1_CONFIG.thresholds;
  if (score >= excellent) return 'Odlične razmere';
  if (score >= veryGood) return 'Zelo dobre razmere';
  if (score >= good) return 'Dobre razmere';
  if (score >= average) return 'Povprečne razmere';
  return 'Slabe razmere';
};

const boletusScoreLabel = (score: number) => {
  const { average, good, veryGood, excellent } = BOLETUS_EDULIS_SCORE_V1_CONFIG.thresholds;
  if (score >= excellent) return 'Odlične razmere';
  if (score >= veryGood) return 'Zelo dobre razmere';
  if (score >= good) return 'Dobre razmere';
  if (score >= average) return 'Povprečne razmere';
  return 'Slabe razmere';
};

const chanterelleScoreLabel = (score: number) => {
  const { average, good, veryGood, excellent } = CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG.thresholds;
  if (score >= excellent) return 'Odlične razmere';
  if (score >= veryGood) return 'Zelo dobre razmere';
  if (score >= good) return 'Dobre razmere';
  if (score >= average) return 'Povprečne razmere';
  return 'Slabe razmere';
};

const lactariusScoreLabel = (score: number) => {
  const { average, good, veryGood, excellent } = LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG.thresholds;
  if (score >= excellent) return 'Odlične razmere';
  if (score >= veryGood) return 'Zelo dobre razmere';
  if (score >= good) return 'Dobre razmere';
  if (score >= average) return 'Povprečne razmere';
  return 'Slabe razmere';
};

const addComponent = (components: MushroomScoreComponent[], component: Omit<MushroomScoreComponent, 'weightedPoints'>) => {
  components.push({ ...component, weightedPoints: component.value * component.weight });
};

const calculateTrend = (
  summary: MushroomWeatherSummary | undefined,
  rain7d: number | undefined,
  dryingSignal: number | undefined,
): MushroomConditionsScore['trend'] => {
  const futureRain7d = summary?.forecast?.rain7dMm;
  return futureRain7d != null
    && futureRain7d >= MUSHROOM_SCORE_V1_CONFIG.futureRain.improving7dMm
    && (rain7d == null || futureRain7d > rain7d)
    ? 'Izboljšanje'
    : futureRain7d != null && futureRain7d <= MUSHROOM_SCORE_V1_CONFIG.futureRain.dry7dMm
      && dryingSignal != null && dryingSignal < 0.5
      ? 'Slabšanje'
      : 'Stabilno';
};

function calculateGenericMushroomWeatherScore(summary?: MushroomWeatherSummary): MushroomConditionsScore {
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
  const trend = calculateTrend(summary, rain7d, dryingSignal);

  const reasons: string[] = [];
  if (rain14d != null) reasons.push(`V zadnjih 14 dneh je bilo ${rain14d.toFixed(1)} mm padavin.`);
  if (avgTemp20d != null) reasons.push(`Povprečna temperatura zadnjih 20 dni je ${avgTemp20d.toFixed(1)} °C.`);
  if (soil0To7 != null && soil7To28 != null) reasons.push(`Modelirana vlaga tal je ${soil0To7.toFixed(3)} m³/m³ v plasti 0–7 cm in ${soil7To28.toFixed(3)} m³/m³ v plasti 7–28 cm.`);
  if (dryingDeficit != null) reasons.push(`Sedemdnevni primanjkljaj padavin glede na ET₀ je ${dryingDeficit.toFixed(1)} mm.`);
  if (trend === 'Izboljšanje' && futureRain7d != null) reasons.push(`Napovedanih ${futureRain7d.toFixed(1)} mm padavin vpliva samo na trend, ne na današnji score.`);
  if (trend === 'Slabšanje') reasons.push('Suha napoved in trenutna bilanca izsuševanja kažeta možnost slabšanja pogojev.');

  return {
    profile: 'generic', score, label: genericScoreLabel(score), trend, components, reasons: reasons.slice(0, 5),
    coverage: components.length === 4 ? 'Padavine, 20-dnevna temperatura, dve plasti vlage tal in bilanca izsuševanja' : 'Ocena uporablja razpoložljive današnje signale; manjkajoča komponenta ni kaznovana.',
  };
}

function calculateBoletusEdulisWeatherScore(summary?: MushroomWeatherSummary): MushroomConditionsScore {
  const historical = summary?.historical;
  const components: MushroomScoreComponent[] = [];
  const rain26d = historical?.rain26dMm;
  const rain7d = historical?.rain7dMm;
  const avgTemp20d = historical?.avgTemp20dC;
  const soil0To7 = summary?.current?.soilMoisture0To7Cm;
  const soil7To28 = summary?.current?.soilMoisture7To28Cm;
  const evapotranspiration7d = historical?.evapotranspiration7dMm;

  if (rain26d != null) {
    const value = clamp(rain26d / BOLETUS_EDULIS_SCORE_V1_CONFIG.rain.fullSignalMm);
    addComponent(components, { key: 'rain26', label: 'Padavine (26 dni)', value, weight: BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights.rain26 });
  }

  if (avgTemp20d != null) {
    const { optimumC, standardDeviationC } = BOLETUS_EDULIS_SCORE_V1_CONFIG.temperature;
    const value = Math.exp(-((avgTemp20d - optimumC) ** 2) / (2 * standardDeviationC ** 2));
    addComponent(components, { key: 'temperature', label: 'Temperatura (20 dni)', value, weight: BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights.temperature });
  }

  const soilConfig = BOLETUS_EDULIS_SCORE_V1_CONFIG.soilMoisture;
  const soilLayers: Array<{ value: number | undefined; weight: number }> = [
    { value: soil0To7, weight: soilConfig.layerWeights.top0To7Cm },
    { value: soil7To28, weight: soilConfig.layerWeights.lower7To28Cm },
  ];
  const availableSoilLayers = soilLayers.filter((layer): layer is { value: number; weight: number } => layer.value != null);
  if (availableSoilLayers.length) {
    const layerWeight = availableSoilLayers.reduce((sum, layer) => sum + layer.weight, 0);
    const value = availableSoilLayers.reduce((sum, layer) => {
      const normalized = clamp((layer.value - soilConfig.baselineM3M3) / soilConfig.rangeM3M3);
      return sum + normalized * layer.weight;
    }, 0) / layerWeight;
    addComponent(components, { key: 'soilMoisture', label: 'Vlaga tal 0–28 cm', value, weight: BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights.soilMoisture });
  }

  let dryingDeficit: number | undefined;
  if (evapotranspiration7d != null && rain7d != null) {
    dryingDeficit = Math.max(evapotranspiration7d - rain7d, 0);
    const value = 1 - clamp(dryingDeficit / BOLETUS_EDULIS_SCORE_V1_CONFIG.drying.fullDeficitMm);
    addComponent(components, { key: 'drying', label: 'Bilanca izsuševanja', value, weight: BOLETUS_EDULIS_SCORE_V1_CONFIG.componentWeights.drying });
  }

  if (!components.length) {
    return {
      profile: 'boletusEdulis', score: undefined, label: 'Premalo podatkov', trend: 'Ni dovolj podatkov', components,
      reasons: ['Za eksperimentalno oceno jesenskega gobana trenutno ni dovolj vremenskih podatkov.'],
      coverage: 'Manjkajo padavine, temperatura, vlaga tal in bilanca izsuševanja.',
    };
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const score = Math.round(components.reduce((sum, component) => sum + component.weightedPoints, 0) / totalWeight * 100);
  const dryingSignal = components.find((component) => component.key === 'drying')?.value;
  const trend = calculateTrend(summary, rain7d, dryingSignal);
  const reasons: string[] = [];

  if (rain26d != null) reasons.push(`V zadnjih 26 dneh je padlo ${rain26d.toFixed(1)} mm padavin.`);
  if (avgTemp20d != null) {
    const difference = Math.abs(avgTemp20d - BOLETUS_EDULIS_SCORE_V1_CONFIG.temperature.optimumC);
    reasons.push(difference <= 3
      ? `20-dnevna povprečna temperatura je ${avgTemp20d.toFixed(1)} °C, blizu 13 °C reference za jesenskega gobana.`
      : `20-dnevna povprečna temperatura je ${avgTemp20d.toFixed(1)} °C, ${avgTemp20d > 13 ? 'nad' : 'pod'} 13 °C referenco.`);
  }
  const soilSignal = components.find((component) => component.key === 'soilMoisture')?.value;
  if (soilSignal != null) {
    const layers = [soil0To7 == null ? undefined : `0–7 cm: ${soil0To7.toFixed(3)} m³/m³`, soil7To28 == null ? undefined : `7–28 cm: ${soil7To28.toFixed(3)} m³/m³`].filter(Boolean).join(', ');
    reasons.push(`${soilSignal >= 0.65 ? 'Tla so dobro navlažena' : 'Modelirana vlaga tal je zmerna ali nizka'} (${layers}).`);
  }
  if (dryingDeficit != null) reasons.push(`Sedemdnevni primanjkljaj padavin glede na ET₀ je ${dryingDeficit.toFixed(1)} mm.`);
  if (trend === 'Izboljšanje') reasons.push('Prihodnje padavine lahko izboljšajo pogoje za razvoj, vendar ne pomenijo takojšnjega pojava trosnjakov.');
  if (trend === 'Slabšanje') reasons.push('Suha napoved in trenutna bilanca izsuševanja kažeta možnost slabšanja pogojev.');

  return {
    profile: 'boletusEdulis', score, label: boletusScoreLabel(score), trend, components, reasons: reasons.slice(0, 5),
    coverage: components.length === 4
      ? '26-dnevne padavine, 20-dnevna temperatura, vlaga tal in bilanca izsuševanja'
      : 'Manjkajoča komponenta je izločena, razpoložljive uteži pa so preračunane na 100 %.',
  };
}

function calculateCantharellusCibariusWeatherScore(summary?: MushroomWeatherSummary): MushroomConditionsScore {
  const historical = summary?.historical;
  const components: MushroomScoreComponent[] = [];
  const rain30d = historical?.rain30dMm;
  const rain7d = historical?.rain7dMm;
  const avgTemp14d = historical?.avgTemp14dC;
  const soil0To7 = summary?.current?.soilMoisture0To7Cm;
  const soil7To28 = summary?.current?.soilMoisture7To28Cm;
  const evapotranspiration7d = historical?.evapotranspiration7dMm;
  const config = CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG;

  if (rain30d != null) {
    const value = clamp(rain30d / config.rain.days30FullSignalMm);
    addComponent(components, { key: 'rain30', label: 'Padavine (30 dni)', value, weight: config.componentWeights.rain30 });
  }

  if (rain7d != null) {
    const value = clamp(rain7d / config.rain.days7FullSignalMm);
    addComponent(components, { key: 'rain7', label: 'Nedavne padavine (7 dni)', value, weight: config.componentWeights.rain7 });
  }

  if (avgTemp14d != null) {
    const { referenceC, standardDeviationC } = config.temperature;
    const value = Math.exp(-((avgTemp14d - referenceC) ** 2) / (2 * standardDeviationC ** 2));
    addComponent(components, { key: 'temperature', label: 'Temperatura (14 dni)', value, weight: config.componentWeights.temperature });
  }

  const soilLayers: Array<{ value: number | undefined; weight: number }> = [
    { value: soil0To7, weight: config.soilMoisture.layerWeights.top0To7Cm },
    { value: soil7To28, weight: config.soilMoisture.layerWeights.lower7To28Cm },
  ];
  const availableSoilLayers = soilLayers.filter((layer): layer is { value: number; weight: number } => layer.value != null);
  if (availableSoilLayers.length) {
    const availableWeight = availableSoilLayers.reduce((sum, layer) => sum + layer.weight, 0);
    const value = availableSoilLayers.reduce((sum, layer) => {
      const normalized = clamp((layer.value - config.soilMoisture.baselineM3M3) / config.soilMoisture.rangeM3M3);
      return sum + normalized * layer.weight;
    }, 0) / availableWeight;
    addComponent(components, { key: 'soilMoisture', label: 'Vlaga tal 0–28 cm', value, weight: config.componentWeights.soilMoisture });
  }

  let dryingDeficit: number | undefined;
  if (evapotranspiration7d != null && rain7d != null) {
    dryingDeficit = Math.max(evapotranspiration7d - rain7d, 0);
    const value = 1 - clamp(dryingDeficit / config.drying.fullDeficitMm);
    addComponent(components, { key: 'drying', label: 'Bilanca izsuševanja', value, weight: config.componentWeights.drying });
  }

  if (!components.length) {
    return {
      profile: 'cantharellusCibarius', score: undefined, label: 'Premalo podatkov', trend: 'Ni dovolj podatkov', components,
      reasons: ['Za eksperimentalno oceno navadne lisičke trenutno ni dovolj vremenskih podatkov.'],
      coverage: 'Manjkajo padavine, temperatura, vlaga tal in bilanca izsuševanja.',
    };
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const score = Math.round(components.reduce((sum, component) => sum + component.weightedPoints, 0) / totalWeight * 100);
  const dryingSignal = components.find((component) => component.key === 'drying')?.value;
  const trend = calculateTrend(summary, rain7d, dryingSignal);
  const reasons: string[] = [];

  if (rain30d != null) {
    const context = rain30d >= 75
      ? 'kar kaže na dobro daljšo navlaženost'
      : rain30d >= 40 ? 'kar kaže na zmerno daljšo navlaženost' : 'zato je signal daljše navlaženosti šibek';
    reasons.push(`V zadnjih 30 dneh je padlo ${rain30d.toFixed(1)} mm padavin, ${context}.`);
  }
  if (rain7d != null) reasons.push(`V zadnjih 7 dneh je padlo ${rain7d.toFixed(1)} mm padavin.`);
  if (avgTemp14d != null) {
    const { researchContextMinC, researchContextMaxC } = config.temperature;
    reasons.push(avgTemp14d >= researchContextMinC && avgTemp14d <= researchContextMaxC
      ? `14-dnevna povprečna temperatura je ${avgTemp14d.toFixed(1)} °C, znotraj 15–20 °C območja, povezanega z ugodnimi razmerami v eni evropski raziskavi.`
      : `14-dnevna povprečna temperatura je ${avgTemp14d.toFixed(1)} °C; temperaturni signal se gladko zmanjšuje z odmikom od 17,5 °C reference.`);
  }
  const soilSignal = components.find((component) => component.key === 'soilMoisture')?.value;
  if (soilSignal != null) {
    const layers = [soil0To7 == null ? undefined : `0–7 cm: ${soil0To7.toFixed(3)} m³/m³`, soil7To28 == null ? undefined : `7–28 cm: ${soil7To28.toFixed(3)} m³/m³`].filter(Boolean).join(', ');
    reasons.push(`${soilSignal >= 0.65 ? 'Tla ostajajo dobro navlažena tudi v globlji razpoložljivi plasti' : 'Modelirana vlaga tal je zmerna ali nizka'} (${layers}).`);
  }
  if (dryingDeficit != null) reasons.push(`Sedemdnevni primanjkljaj padavin glede na ET₀ je ${dryingDeficit.toFixed(1)} mm.`);
  if (trend === 'Izboljšanje') reasons.push('Prihodnje padavine lahko pomagajo ohranjati vlažne razmere, vendar same ne pomenijo takojšnjega pojava lisičk.');
  if (trend === 'Slabšanje') reasons.push('Suha napoved in trenutna bilanca izsuševanja kažeta možnost slabšanja pogojev.');

  return {
    profile: 'cantharellusCibarius', score, label: chanterelleScoreLabel(score), trend, components, reasons: reasons.slice(0, 5),
    coverage: components.length === 5
      ? '30- in 7-dnevne padavine, 14-dnevna temperatura, vlaga tal in bilanca izsuševanja'
      : 'Manjkajoča komponenta je izločena, razpoložljive uteži pa so preračunane na 100 %.',
  };
}

function calculateLactariusDeliciosusWeatherScore(summary?: MushroomWeatherSummary): MushroomConditionsScore {
  const historical = summary?.historical;
  const components: MushroomScoreComponent[] = [];
  const rain60d = historical?.rain60dMm;
  const rain14d = historical?.rain14dMm;
  const rain7d = historical?.rain7dMm;
  const avgTemp20d = historical?.avgTemp20dC;
  const soil0To7 = summary?.current?.soilMoisture0To7Cm;
  const soil7To28 = summary?.current?.soilMoisture7To28Cm;
  const evapotranspiration7d = historical?.evapotranspiration7dMm;
  const config = LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG;

  if (rain60d != null) {
    const value = 1 - Math.exp(-rain60d / config.rain.days60ScaleMm);
    addComponent(components, { key: 'rain60', label: 'Padavine (60 dni)', value, weight: config.componentWeights.rain60 });
  }

  if (rain14d != null) {
    const value = 1 - Math.exp(-rain14d / config.rain.days14ScaleMm);
    addComponent(components, { key: 'rain14', label: 'Nedavne padavine (14 dni)', value, weight: config.componentWeights.rain14 });
  }

  if (avgTemp20d != null) {
    const { coldFloorC, fullColdSupportC, heatPenaltyStartC, heatPenaltyEndC } = config.temperature;
    const coldSupport = clamp((avgTemp20d - coldFloorC) / (fullColdSupportC - coldFloorC));
    const heatSupport = 1 - clamp((avgTemp20d - heatPenaltyStartC) / (heatPenaltyEndC - heatPenaltyStartC));
    addComponent(components, { key: 'temperature', label: 'Temperatura (20 dni)', value: coldSupport * heatSupport, weight: config.componentWeights.temperature });
  }

  const soilLayers: Array<{ value: number | undefined; weight: number }> = [
    { value: soil0To7, weight: config.soilMoisture.layerWeights.top0To7Cm },
    { value: soil7To28, weight: config.soilMoisture.layerWeights.lower7To28Cm },
  ];
  const availableSoilLayers = soilLayers.filter((layer): layer is { value: number; weight: number } => layer.value != null);
  if (availableSoilLayers.length) {
    const availableWeight = availableSoilLayers.reduce((sum, layer) => sum + layer.weight, 0);
    const value = availableSoilLayers.reduce((sum, layer) => {
      const normalized = clamp((layer.value - config.soilMoisture.baselineM3M3) / config.soilMoisture.rangeM3M3);
      return sum + normalized * layer.weight;
    }, 0) / availableWeight;
    addComponent(components, { key: 'soilMoisture', label: 'Vlaga tal 0–28 cm', value, weight: config.componentWeights.soilMoisture });
  }

  let dryingDeficit: number | undefined;
  if (evapotranspiration7d != null && rain7d != null) {
    dryingDeficit = Math.max(evapotranspiration7d - rain7d, 0);
    const value = 1 - clamp(dryingDeficit / config.drying.fullDeficitMm);
    addComponent(components, { key: 'drying', label: 'Bilanca izsuševanja', value, weight: config.componentWeights.drying });
  }

  // Long rainfall history and 20-day temperature are required. Optional components are
  // excluded and the remaining available weights are transparently normalized to 100%.
  if (rain60d == null || avgTemp20d == null) {
    return {
      profile: 'lactariusDeliciosus', score: undefined, label: 'Premalo podatkov', trend: 'Ni dovolj podatkov', components,
      reasons: ['Za eksperimentalno oceno užitne sirovke potrebujemo 60 zaključenih dni padavin in 20-dnevno povprečno temperaturo.'],
      coverage: 'Ključna 60-dnevna zgodovina padavin ali temperatura ni popolna; manjkajočih dni ne obravnavamo kot 0 mm.',
    };
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const score = Math.round(components.reduce((sum, component) => sum + component.weightedPoints, 0) / totalWeight * 100);
  const dryingSignal = components.find((component) => component.key === 'drying')?.value;
  const trend = calculateTrend(summary, rain7d, dryingSignal);
  const reasons: string[] = [];

  const rainContext = rain60d >= 120
    ? 'kar kaže na dobro dolgotrajno navlaženost'
    : rain60d >= 60 ? 'kar kaže na zmerno dolgotrajno navlaženost' : 'zato je signal dolgotrajne navlaženosti šibek';
  reasons.push(`V zadnjih 60 dneh je padlo ${rain60d.toFixed(1)} mm padavin, ${rainContext}.`);
  if (rain14d != null) reasons.push(`V zadnjih 14 dneh je padlo ${rain14d.toFixed(1)} mm padavin.`);
  if (avgTemp20d > config.temperature.heatPenaltyStartC) {
    reasons.push(`20-dnevna povprečna temperatura je ${avgTemp20d.toFixed(1)} °C; dalj časa trajajoče visoke temperature zmanjšujejo temperaturni signal.`);
  } else if (avgTemp20d < config.temperature.fullColdSupportC) {
    reasons.push(`20-dnevna povprečna temperatura je ${avgTemp20d.toFixed(1)} °C; dolgotrajno hladni pogoji zmanjšujejo temperaturni signal.`);
  } else {
    reasons.push(`20-dnevna povprečna temperatura je ${avgTemp20d.toFixed(1)} °C in ostaja v območju, ki ga eksperimentalni model obravnava kot ugodno.`);
  }
  const soilSignal = components.find((component) => component.key === 'soilMoisture')?.value;
  if (soilSignal != null) {
    const layers = [soil0To7 == null ? undefined : `0–7 cm: ${soil0To7.toFixed(3)} m³/m³`, soil7To28 == null ? undefined : `7–28 cm: ${soil7To28.toFixed(3)} m³/m³`].filter(Boolean).join(', ');
    reasons.push(`${soilSignal >= 0.65 ? 'Tla so dobro navlažena tudi v globlji razpoložljivi plasti' : 'Modelirana vlaga tal je zmerna ali nizka'} (${layers}).`);
  }
  if (dryingDeficit != null) reasons.push(`Sedemdnevni primanjkljaj padavin glede na ET₀ je ${dryingDeficit.toFixed(1)} mm.`);
  if (trend === 'Izboljšanje') reasons.push('Prihodnje padavine lahko pripomorejo k ohranjanju vlažnih razmer, vendar same ne pomenijo takojšnjega pojava trosnjakov.');
  if (trend === 'Slabšanje') reasons.push('Suha napoved in trenutna bilanca izsuševanja kažeta možnost slabšanja pogojev.');

  return {
    profile: 'lactariusDeliciosus', score, label: lactariusScoreLabel(score), trend, components, reasons: reasons.slice(0, 5),
    coverage: components.length === 5
      ? '60- in 14-dnevne padavine, 20-dnevna temperatura, vlaga tal in bilanca izsuševanja'
      : 'Manjkajoča opcijska komponenta je izločena, razpoložljive uteži pa so preračunane na 100 %.',
  };
}

export const MUSHROOM_WEATHER_PROFILES: Record<MushroomWeatherProfileId, MushroomWeatherProfileDefinition> = {
  generic: {
    id: 'generic',
    label: 'Splošno',
    scoreTitle: 'Gobarski signal',
    scoreCaption: 'Eksperimentalna ocena',
    forecastNote: 'Napovedane padavine kažejo potencial za poznejšo spremembo pogojev, ne takojšnjega pojava gob. Ne vplivajo na današnji score, ampak samo na trend.',
    evidenceNote: 'Splošen profil združuje več časovnih oken padavin, temperaturo, vlago tal in izsuševanje.',
    tuningNote: 'Vsi pragovi in uteži so eksperimentalne tuning konstante.',
    calculate: calculateGenericMushroomWeatherScore,
  },
  boletusEdulis: {
    id: 'boletusEdulis',
    label: BOLETUS_EDULIS_SCORE_V1_CONFIG.label,
    scientificName: BOLETUS_EDULIS_SCORE_V1_CONFIG.scientificName,
    speciesId: BOLETUS_EDULIS_SCORE_V1_CONFIG.speciesId,
    scoreTitle: 'Razmere za jesenskega gobana',
    scoreCaption: 'Eksperimentalna ocena',
    forecastNote: 'Prihodnje padavine lahko izboljšajo pogoje za razvoj, vendar ne pomenijo takojšnjega pojava trosnjakov. Na današnji score ne vplivajo.',
    evidenceNote: 'Profil uporablja raziskovalno podprti 20-dnevni temperaturni in približno 26-dnevni padavinski kontekst.',
    tuningNote: 'Uteži, 100 mm padavinska referenca in temperaturna sigma 4,5 °C so eksperimentalne tuning konstante.',
    calculate: calculateBoletusEdulisWeatherScore,
  },
  cantharellusCibarius: {
    id: 'cantharellusCibarius',
    label: CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG.label,
    scientificName: CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG.scientificName,
    speciesId: CANTHARELLUS_CIBARIUS_SCORE_V1_CONFIG.speciesId,
    scoreTitle: 'Razmere za navadno lisičko',
    scoreCaption: 'Vremenske razmere · od 100',
    forecastNote: 'Prihodnje padavine lahko pomagajo ohranjati vlažne razmere, vendar same ne pomenijo takojšnjega pojava lisičk. Na današnji score ne vplivajo.',
    seasonNote: 'Navadna lisička v Sloveniji običajno raste od začetka poletja do pozne jeseni. Sezona ni del izračuna.',
    evidenceNote: 'Profil uporablja daljšo in nedavno akumulacijo padavin, 14-dnevno temperaturo ter vlago tal kot raziskovalno motivirane signale.',
    tuningNote: 'Uteži, 100/25 mm padavinski referenci, center 17,5 °C, sigma 6,0 °C in scaling izsuševanja so eksperimentalne tuning konstante.',
    calculate: calculateCantharellusCibariusWeatherScore,
  },
  lactariusDeliciosus: {
    id: 'lactariusDeliciosus',
    label: LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG.label,
    scientificName: LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG.scientificName,
    speciesId: LACTARIUS_DELICIOSUS_SCORE_V1_CONFIG.speciesId,
    scoreTitle: 'Razmere za užitno sirovko',
    scoreCaption: 'Vremenske razmere · od 100',
    forecastNote: 'Prihodnje padavine lahko pripomorejo k ohranjanju vlažnih razmer, vendar same ne pomenijo takojšnjega pojava trosnjakov. Na današnji score ne vplivajo.',
    seasonNote: 'Užitna sirovka je značilna predvsem za pozno poletje in jesen ter je mikorizno povezana predvsem z bori. Vremenska ocena ne preverja sezone ali prisotnosti ustreznega habitata.',
    evidenceNote: 'Profil uporablja daljše in nedavne padavine, vlago tal ter temperaturo kot raziskovalno motivirane signale.',
    tuningNote: '60-dnevno okno, uteži 35/10/25/25/5, padavinski skali 100/20 mm, temperaturni pragovi 3/8/16/24 °C in scaling izsuševanja so eksperimentalne V1 tuning konstante.',
    calculate: calculateLactariusDeliciosusWeatherScore,
  },
};

export function calculateMushroomWeatherScore(
  summary?: MushroomWeatherSummary,
  profileId: MushroomWeatherProfileId = 'generic',
): MushroomConditionsScore {
  return MUSHROOM_WEATHER_PROFILES[profileId].calculate(summary);
}
