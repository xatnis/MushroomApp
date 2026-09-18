export type Visibility = 'private' | 'friends' | 'community';
export type LocationSharing = 'private' | 'friends';
export type Outcome = 'found' | 'nothing' | 'unspecified';
export type QuantityUnit = 'pieces' | 'g' | 'kg';
export type SyncState = 'local' | 'pending' | 'synced' | 'attention';
export type WeatherStatus = 'pending' | 'complete' | 'missing' | 'error';

export interface ExploreLocation {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  admin2?: string;
  country?: string;
  source: 'place' | 'gps';
}

export interface MushroomSpecies {
  id: string;
  nameSl: string;
  scientificName?: string;
  aliases: string[];
  kind: 'species' | 'group' | 'unknown' | 'custom';
}

export interface Hotspot {
  id: string;
  profileId: string;
  latitude: number;
  longitude: number;
  title?: string;
  locationName?: string;
  locationAdmin1?: string;
  locationAdmin2?: string;
  locationCountry?: string;
  notes?: string;
  locationSource: 'gps' | 'manual' | 'imported';
  accuracyM?: number;
  locationSharing: LocationSharing;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  syncState: SyncState;
  serverRevision?: number;
}

export interface FindItem {
  id: string;
  findId: string;
  speciesId?: string;
  customName?: string;
  quantity?: number;
  unit?: QuantityUnit;
  searchedFor: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  syncState: SyncState;
}

export interface FindPhoto {
  id: string;
  findId: string;
  localUri: string;
  storagePath?: string;
  width?: number;
  height?: number;
  uploadState: 'local' | 'pending' | 'uploaded' | 'failed';
  createdAt: string;
  deletedAt?: string;
}

export interface WeatherSnapshot {
  provider: 'open-meteo';
  weatherTime?: string;
  retrievedAt?: string;
  dataset?: 'forecast' | 'archive';
  temperatureC?: number;
  precipitationMm?: number;
  precipitation24hMm?: number;
  precipitation3dMm?: number;
  precipitation7dMm?: number;
  status: WeatherStatus;
  error?: string;
}

export interface FindRecord {
  id: string;
  hotspotId: string;
  profileId: string;
  observedAt: string;
  observationLatitude: number;
  observationLongitude: number;
  observationAccuracyM?: number;
  outcome: Outcome;
  notes?: string;
  visibility: Visibility;
  shareExactCommunityLocation: boolean;
  weather: WeatherSnapshot;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  syncState: SyncState;
  serverRevision?: number;
  items: FindItem[];
  photos: FindPhoto[];
}

export interface HotspotWithHistory extends Hotspot {
  finds: FindRecord[];
}

export interface ProfileSummary {
  id: string;
  mode: 'local' | 'cloud';
  accountId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface DraftItem {
  id: string;
  speciesId?: string;
  customName?: string;
  quantityText: string;
  unit?: QuantityUnit;
  searchedFor: boolean;
}

export interface RecordingDraft {
  hotspotId?: string;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  locationSource?: 'gps' | 'manual';
  locationName?: string;
  locationAdmin1?: string;
  locationAdmin2?: string;
  locationCountry?: string;
  hotspotTitle?: string;
  observedAt: string;
  outcome: Outcome;
  notes: string;
  visibility: Visibility;
  shareExactCommunityLocation: boolean;
  items: DraftItem[];
  photoUris: string[];
}

export interface ConditionsData {
  latitude: number;
  longitude: number;
  temperatureC?: number;
  precipitation24hMm?: number;
  precipitation3dMm?: number;
  precipitation7dMm?: number;
  hoursSinceMeaningfulRain?: number;
  upcomingPrecipitationMm?: number;
  timeline: Array<{ at: string; precipitationMm?: number }>;
  updatedAt: string;
  stale: boolean;
  source: 'open-meteo';
}

export interface DailyWeatherPoint {
  date: string;
  kind: 'historical' | 'forecast';
  precipitationMm?: number;
  temperatureMinC?: number;
  temperatureMaxC?: number;
  temperatureMeanC?: number;
  evapotranspirationMm?: number;
  weatherCode?: number;
}

export interface HistoricalWeatherSummary {
  days: DailyWeatherPoint[];
  rain3dMm?: number;
  rain7dMm?: number;
  rain14dMm?: number;
  rain30dMm?: number;
  avgTemp7dC?: number;
  avgTemp14dC?: number;
  avgTemp20dC?: number;
  evapotranspiration7dMm?: number;
  coverage: {
    rain3dDays: number;
    rain7dDays: number;
    rain14dDays: number;
    rain30dDays: number;
    temp7dDays: number;
    temp14dDays: number;
    temp20dDays: number;
    evapotranspiration7dDays: number;
  };
}

export interface ForecastWeatherSummary {
  days: DailyWeatherPoint[];
  rain3dMm?: number;
  rain7dMm?: number;
}

export interface CurrentWeatherSummary {
  time?: string;
  temperatureC?: number;
  weatherCode?: number;
  weatherDescription?: string;
  soilMoisture0To7Cm?: number;
  soilMoisture7To28Cm?: number;
}

export interface MushroomWeatherSummary {
  latitude: number;
  longitude: number;
  current?: CurrentWeatherSummary;
  historical?: HistoricalWeatherSummary;
  forecast?: ForecastWeatherSummary;
  errors: { historical?: string; forecast?: string };
  updatedAt: string;
  stale: boolean;
  source: 'open-meteo';
}

export interface MushroomScoreComponent {
  key: 'rain' | 'temperature' | 'soilMoisture' | 'drying';
  label: string;
  value: number;
  weight: number;
  weightedPoints: number;
}

export interface MushroomConditionsScore {
  profile: 'generic';
  score?: number;
  label: string;
  trend: 'Izboljšanje' | 'Stabilno' | 'Slabšanje' | 'Ni dovolj podatkov';
  reasons: string[];
  coverage: string;
  components: MushroomScoreComponent[];
}

export interface ScoreResult {
  score?: number;
  label: string;
  reasons: string[];
  coverage: string;
}

export interface CommunityCard {
  findId: string;
  username: string;
  displayName?: string;
  avatarPath?: string;
  species: string[];
  quantities: string[];
  observedAt: string;
  temperatureC?: number;
  notes?: string;
  locationName?: string;
  photoPaths: string[];
}
