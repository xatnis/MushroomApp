import type { LocationGeocodedAddress } from 'expo-location';
import type { ExploreLocation } from '../domain/types';
import { haversineKm } from '../domain/format';
import { searchLocations, type PlaceSearchResult } from './weather';

export const LOCALITY_CROSS_CHECK_MAX_CANDIDATES = 3;
export const LOCALITY_CROSS_CHECK_TIMEOUT_MS = 8_000;
export const LOCALITY_MAX_MATCH_DISTANCE_KM = 10;
const LOCALITY_SEARCH_CACHE_MS = 30 * 60_000;

type CandidateSource = 'district' | 'city' | 'subregion' | 'name' | 'formattedAddress';

export interface LocalityCandidate {
  label: string;
  sources: CandidateSource[];
  occurrences: number;
  addressIndex: number;
}

export interface LocalityResolution {
  name?: string;
  admin1?: string;
  admin2?: string;
  country?: string;
  candidates: LocalityCandidate[];
  method: 'reverseGeocode' | 'geographicCrossCheck' | 'neutralFallback';
  distanceKm?: number;
}

export interface ResolveGpsLocalityOptions {
  addresses: LocationGeocodedAddress[];
  latitude: number;
  longitude: number;
  signal?: AbortSignal;
  search?: typeof searchLocations;
}

interface CachedSearch {
  expiresAt: number;
  results: PlaceSearchResult[];
}

const searchCache = new Map<string, CachedSearch>();

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('sl-SI')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const cleanAdministrativePrefix = (value: string) => value
  .replace(/^(?:(?:mestna\s+)?občina|upravna\s+enota)\s+/i, '')
  .trim();

const cleanCandidateText = (value?: string | null) => {
  if (!value) return undefined;
  const cleaned = cleanAdministrativePrefix(value)
    .replace(/^(?:SI[-\s]*)?\d{4}\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,;\s]+|[,;\s]+$/g, '');
  return cleaned || undefined;
};

const isCountry = (value: string) => ['slovenija', 'slovenia'].includes(normalize(value));
const isPostcodeOnly = (value: string) => /^(?:SI[-\s]*)?\d{4}$/i.test(value.trim());
const hasHouseNumber = (value: string) => /\d/.test(value);
const looksLikeStreet = (value: string) => /\b(?:ulica|cesta|pot|trg|nabrežje|avenija)\b/i.test(value);

const sourcePriority: Record<CandidateSource, number> = {
  district: 0,
  name: 1,
  city: 2,
  subregion: 3,
  formattedAddress: 4,
};

export function sanitizeReverseGeocodeResults(addresses: LocationGeocodedAddress[]) {
  return addresses.map((address, index) => ({
    index,
    name: address.name,
    city: address.city,
    district: address.district,
    subregion: address.subregion,
    region: address.region,
    postalCode: address.postalCode,
    formattedAddress: address.formattedAddress,
    country: address.country,
  }));
}

export function extractLocalityCandidates(addresses: LocationGeocodedAddress[]): LocalityCandidate[] {
  const candidates = new Map<string, LocalityCandidate>();

  const add = (raw: string | null | undefined, source: CandidateSource, addressIndex: number) => {
    const address = addresses[addressIndex];
    const cleaned = cleanCandidateText(raw);
    if (!cleaned || isCountry(cleaned) || isPostcodeOnly(cleaned) || hasHouseNumber(cleaned) || looksLikeStreet(cleaned)) return;
    if (address?.country && normalize(cleaned) === normalize(address.country)) return;
    if (address?.region && normalize(cleaned) === normalize(cleanAdministrativePrefix(address.region))) return;
    if (address?.street && normalize(cleaned) === normalize(address.street)) return;

    const key = normalize(cleaned);
    if (!key) return;
    const existing = candidates.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    candidates.set(key, { label: cleaned, sources: [source], occurrences: 1, addressIndex });
  };

  addresses.forEach((address, addressIndex) => {
    add(address.district, 'district', addressIndex);
    add(address.name, 'name', addressIndex);
    add(address.city, 'city', addressIndex);
    add(address.subregion, 'subregion', addressIndex);
    address.formattedAddress?.split(',').forEach((part) => add(part, 'formattedAddress', addressIndex));
  });

  return [...candidates.values()].sort((a, b) =>
    b.occurrences - a.occurrences
    || Math.min(...a.sources.map((source) => sourcePriority[source])) - Math.min(...b.sources.map((source) => sourcePriority[source])),
  );
}

const isSlovenianResult = (place: PlaceSearchResult) => !place.country || ['slovenija', 'slovenia'].includes(normalize(place.country));

const searchWithCache = async (
  query: string,
  search: typeof searchLocations,
  signal: AbortSignal,
) => {
  const key = normalize(query);
  if (search === searchLocations) {
    const cached = searchCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.results;
  }
  const results = await search(query, signal);
  if (search === searchLocations) searchCache.set(key, { results, expiresAt: Date.now() + LOCALITY_SEARCH_CACHE_MS });
  return results;
};

const metadataFromAddress = (address?: LocationGeocodedAddress) => ({
  admin1: cleanCandidateText(address?.region),
  admin2: cleanCandidateText(address?.subregion),
  country: address?.country ?? undefined,
});

export async function resolveGpsLocality(options: ResolveGpsLocalityOptions): Promise<LocalityResolution> {
  const candidates = extractLocalityCandidates(options.addresses);
  if (!candidates.length) return { candidates, method: 'neutralFallback' };

  const first = candidates[0];
  const unambiguous = candidates.length === 1 && first.occurrences >= 2;
  if (unambiguous) {
    return {
      name: first.label,
      ...metadataFromAddress(options.addresses[first.addressIndex]),
      candidates,
      method: 'reverseGeocode',
    };
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), LOCALITY_CROSS_CHECK_TIMEOUT_MS);
  const search = options.search ?? searchLocations;

  try {
    const checked = await Promise.allSettled(
      candidates.slice(0, LOCALITY_CROSS_CHECK_MAX_CANDIDATES).map(async (candidate) => {
        const results = await searchWithCache(candidate.label, search, controller.signal);
        const exactResults = results.filter((place) =>
          isSlovenianResult(place) && normalize(place.name) === normalize(candidate.label),
        );
        return exactResults.map((place) => ({
          candidate,
          place,
          distanceKm: haversineKm(options.latitude, options.longitude, place.latitude, place.longitude),
        }));
      }),
    );
    const nearest = checked
      .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];

    if (!nearest || nearest.distanceKm > LOCALITY_MAX_MATCH_DISTANCE_KM) {
      return { candidates, method: 'neutralFallback' };
    }
    return {
      name: cleanCandidateText(nearest.place.name),
      admin1: nearest.place.admin1,
      admin2: nearest.place.admin2,
      country: nearest.place.country,
      candidates,
      method: 'geographicCrossCheck',
      distanceKm: nearest.distanceKm,
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function buildGpsExploreLocation(
  latitude: number,
  longitude: number,
  resolution: LocalityResolution,
): ExploreLocation {
  return {
    name: resolution.name ?? 'Moja lokacija',
    latitude,
    longitude,
    admin1: resolution.admin1,
    admin2: resolution.admin2,
    country: resolution.country,
    source: 'gps',
  };
}

export function debugGpsLocality(
  source: 'fresh' | 'lastKnown',
  accuracyM: number | null,
  addresses: LocationGeocodedAddress[],
  resolution: LocalityResolution,
) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.info('[Locality] GPS reverse-geocode', {
    source,
    accuracyM,
    addresses: sanitizeReverseGeocodeResults(addresses),
    candidates: resolution.candidates.map(({ label, sources, occurrences }) => ({ label, sources, occurrences })),
    method: resolution.method,
    crossCheckDistanceKm: resolution.distanceKm,
    finalLabel: resolution.name ?? 'Moja lokacija',
  });
}
