import { MUSHROOM_SCORE_V1_CONFIG } from './mushroomWeather';
import { slNumber } from './format';
import type { MushroomConditionsScore, MushroomWeatherSummary } from './types';

export interface WeatherDetailRow {
  label: string;
  value: string;
}

export interface WeatherDetailSection {
  title: string;
  rows: WeatherDetailRow[];
}

export interface GenericWeatherDetailsModel {
  description: string;
  scoreSections: WeatherDetailSection[];
  total: string;
  coverage: string;
  trendRows: WeatherDetailRow[];
  trendNote: string;
}

const weatherValue = (value: number | undefined, unit: string, digits = 1) =>
  value == null ? 'ni podatka' : `${slNumber(value, digits)} ${unit}`;

const contribution = (
  score: MushroomConditionsScore,
  key: 'rain' | 'temperature' | 'soilMoisture' | 'drying',
  maximum: number,
) => {
  const component = score.components.find((item) => item.key === key);
  return component ? `${slNumber(component.weightedPoints, 1)} / ${maximum}` : `ni podatka / ${maximum}`;
};

const historyCoverage = (summary: MushroomWeatherSummary) => {
  const coverage = summary.historical?.coverage;
  if (coverage?.rain30dDays === 30 && coverage.temp20dDays === 20) {
    return 'Podatki: popolna 30-dnevna vremenska zgodovina.';
  }
  if (!coverage) return 'Podatki so delno omejeni.';
  return `Podatki so delno omejeni. Pokritost: padavine ${coverage.rain30dDays}/30 dni, temperatura ${coverage.temp20dDays}/20 dni.`;
};

export function buildGenericWeatherDetails(
  summary: MushroomWeatherSummary,
  score: MushroomConditionsScore,
): GenericWeatherDetailsModel {
  const historical = summary.historical;
  const current = summary.current;
  const forecast = summary.forecast;
  const weights = MUSHROOM_SCORE_V1_CONFIG.componentWeights;

  return {
    description: 'Splošna ocena združuje pretekle padavine, temperaturo, vlago tal in izsuševanje. Predstavlja primernost vremenskih razmer za rast gob na splošno, ne verjetnosti najdbe posamezne vrste.',
    scoreSections: [
      {
        title: 'PADAVINE',
        rows: [
          { label: 'Zadnjih 7 dni', value: weatherValue(historical?.rain7dMm, 'mm') },
          { label: 'Zadnjih 14 dni', value: weatherValue(historical?.rain14dMm, 'mm') },
          { label: 'Zadnjih 30 dni', value: weatherValue(historical?.rain30dMm, 'mm') },
          { label: 'Prispevek', value: contribution(score, 'rain', weights.rain) },
        ],
      },
      {
        title: 'TEMPERATURA',
        rows: [
          { label: 'Povprečje 20 dni', value: weatherValue(historical?.avgTemp20dC, '°C') },
          { label: 'Prispevek', value: contribution(score, 'temperature', weights.temperature) },
        ],
      },
      {
        title: 'VLAGA TAL',
        rows: [
          { label: '0–7 cm', value: weatherValue(current?.soilMoisture0To7Cm, 'm³/m³', 3) },
          { label: '7–28 cm', value: weatherValue(current?.soilMoisture7To28Cm, 'm³/m³', 3) },
          { label: 'Prispevek', value: contribution(score, 'soilMoisture', weights.soilMoisture) },
        ],
      },
      {
        title: 'IZSUŠEVANJE',
        rows: [
          { label: 'ET₀ zadnjih 7 dni', value: weatherValue(historical?.evapotranspiration7dMm, 'mm') },
          { label: 'Padavine 7 dni', value: weatherValue(historical?.rain7dMm, 'mm') },
          { label: 'Prispevek', value: contribution(score, 'drying', weights.drying) },
        ],
      },
    ],
    total: score.score == null ? 'ni podatka' : `${score.score} / 100`,
    coverage: historyCoverage(summary),
    trendRows: [
      { label: 'Prihodnji 3 dnevi', value: weatherValue(forecast?.rain3dMm, 'mm') },
      { label: 'Prihodnjih 7 dni', value: weatherValue(forecast?.rain7dMm, 'mm') },
    ],
    trendNote: 'Napoved prihodnjih padavin ne spreminja današnje ocene, ampak kaže možen razvoj razmer.',
  };
}
