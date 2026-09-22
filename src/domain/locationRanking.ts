import { calculateMushroomWeatherScore } from './mushroomWeather';
import type {
  MushroomConditionsScore,
  MushroomScoreComponent,
  MushroomWeatherProfileId,
  MushroomWeatherSummary,
} from './types';

export type LocationRankingDataQuality = 'complete' | 'limited' | 'insufficient';

export interface LocationRankingAssessment {
  profileId: MushroomWeatherProfileId;
  usesGenericFallback: boolean;
  score: MushroomConditionsScore;
  dataQuality: LocationRankingDataQuality;
  reason: string;
}

const SPECIES_PROFILE_IDS: Readonly<Record<string, MushroomWeatherProfileId>> = {
  'boletus-edulis': 'boletusEdulis',
  'cantharellus-cibarius': 'cantharellusCibarius',
  'lactarius-deliciosus': 'lactariusDeliciosus',
};

const EXPECTED_COMPONENTS: Readonly<Record<MushroomWeatherProfileId, readonly MushroomScoreComponent['key'][]>> = {
  generic: ['rain', 'temperature', 'soilMoisture', 'drying'],
  boletusEdulis: ['rain26', 'temperature', 'soilMoisture', 'drying'],
  cantharellusCibarius: ['rain30', 'rain7', 'temperature', 'soilMoisture', 'drying'],
  lactariusDeliciosus: ['rain60', 'rain14', 'soilMoisture', 'temperature', 'drying'],
};

const signal = (score: MushroomConditionsScore, key: MushroomScoreComponent['key']) =>
  score.components.find((component) => component.key === key)?.value;

const high = (value: number | undefined) => value != null && value >= 0.65;
const low = (value: number | undefined) => value != null && value < 0.4;

export function rankingProfileForSpecies(speciesId?: string): {
  profileId: MushroomWeatherProfileId;
  usesGenericFallback: boolean;
} {
  if (!speciesId) return { profileId: 'generic', usesGenericFallback: false };
  const profileId = SPECIES_PROFILE_IDS[speciesId];
  return profileId
    ? { profileId, usesGenericFallback: false }
    : { profileId: 'generic', usesGenericFallback: true };
}

export function locationRankingDataQuality(
  score: MushroomConditionsScore,
  profileId: MushroomWeatherProfileId,
): LocationRankingDataQuality {
  if (score.score == null) return 'insufficient';
  const available = new Set(score.components.map((component) => component.key));
  return EXPECTED_COMPONENTS[profileId].every((key) => available.has(key)) ? 'complete' : 'limited';
}

export function locationRankingReason(score: MushroomConditionsScore): string {
  if (score.score == null) return 'Ni dovolj podatkov za zanesljivo oceno.';

  const rain = signal(score, score.profile === 'boletusEdulis' ? 'rain26'
    : score.profile === 'cantharellusCibarius' ? 'rain30'
      : score.profile === 'lactariusDeliciosus' ? 'rain60' : 'rain');
  const temperature = signal(score, 'temperature');
  const soil = signal(score, 'soilMoisture');

  if (low(rain)) return score.profile === 'generic'
    ? 'Daljša navlaženost je šibka.'
    : 'Padavin v ključnem obdobju je malo za izbrani profil.';
  if (low(temperature)) return 'Temperaturne razmere so za izbrani profil manj ugodne.';
  if (high(rain) && high(soil)) return score.profile === 'lactariusDeliciosus'
    ? 'Dobra 60-dnevna navlaženost in vlaga tal.'
    : score.profile === 'cantharellusCibarius'
      ? 'Dobra daljša navlaženost in visoka vlaga tal.'
      : 'Veliko padavin v zadnjih tednih in dobra vlaga tal.';
  if (high(rain) && high(temperature)) return score.profile === 'boletusEdulis'
    ? 'Dobra 26-dnevna navlaženost in ugodna 20-dnevna temperatura.'
    : score.profile === 'lactariusDeliciosus'
      ? 'Dobra 60-dnevna navlaženost; temperatura ostaja ugodna.'
      : 'Padavine in temperatura podpirajo trenutne razmere.';
  return score.reasons[0] ?? score.coverage;
}

export function assessLocationWeather(
  summary: MushroomWeatherSummary | undefined,
  speciesId?: string,
): LocationRankingAssessment {
  const { profileId, usesGenericFallback } = rankingProfileForSpecies(speciesId);
  const score = calculateMushroomWeatherScore(summary, profileId);
  return {
    profileId,
    usesGenericFallback,
    score,
    dataQuality: locationRankingDataQuality(score, profileId),
    reason: locationRankingReason(score),
  };
}
