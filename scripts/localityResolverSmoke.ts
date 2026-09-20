import type { LocationGeocodedAddress } from 'expo-location';
import {
  buildGpsExploreLocation,
  extractLocalityCandidates,
  resolveGpsLocality,
  type ResolveGpsLocalityOptions,
} from '../src/services/locality';
import type { PlaceSearchResult } from '../src/services/weather';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const address = (values: Partial<LocationGeocodedAddress>): LocationGeocodedAddress => ({
  city: null,
  country: 'Slovenija',
  district: null,
  formattedAddress: null,
  isoCountryCode: 'SI',
  name: null,
  postalCode: null,
  region: null,
  street: null,
  streetNumber: null,
  subregion: null,
  timezone: null,
  ...values,
});

const places: Record<string, PlaceSearchResult[]> = {
  'Črna na Koroškem': [{ id: 1, name: 'Črna na Koroškem', latitude: 46.47045, longitude: 14.85009, country: 'Slovenija', admin1: 'Občina Črna na Koroškem' }],
  'Ravne na Koroškem': [{ id: 2, name: 'Ravne na Koroškem', latitude: 46.54315, longitude: 14.97053, country: 'Slovenija', admin1: 'Občina Ravne na Koroškem' }],
  Maribor: [{ id: 3, name: 'Maribor', latitude: 46.55583, longitude: 15.64593, country: 'Slovenija' }],
  Kočevje: [{ id: 4, name: 'Kočevje', latitude: 45.64323, longitude: 14.86036, country: 'Slovenija' }],
};

const searchQueries: string[] = [];
const mockSearch = async (query: string, _signal?: AbortSignal) => {
  searchQueries.push(query);
  return places[query] ?? [];
};
const resolve = (values: Omit<ResolveGpsLocalityOptions, 'search'>) => resolveGpsLocality({ ...values, search: mockSearch });

async function run() {
  const crnaAddresses = [address({
    city: 'Ravne na Koroškem',
    district: 'Črna na Koroškem',
    subregion: 'Upravna enota Ravne na Koroškem',
    name: 'Črna na Koroškem',
    region: 'Koroška',
    postalCode: '2393',
    formattedAddress: '2393 Črna na Koroškem, Slovenija',
  })];
  const crna = await resolve({ addresses: crnaAddresses, latitude: 46.47045, longitude: 14.85009 });
  assert(crna.name === 'Črna na Koroškem', `Črna/Ravne fixture resolved to ${crna.name}`);
  assert(crna.method === 'geographicCrossCheck', 'Ambiguous Črna/Ravne fixture must use geographic cross-check.');

  searchQueries.length = 0;
  const maribor = await resolve({
    addresses: [address({ city: 'Maribor', district: 'Maribor', name: 'Maribor', formattedAddress: 'Maribor, Slovenija' })],
    latitude: 46.55583,
    longitude: 15.64593,
  });
  assert(maribor.name === 'Maribor', `Maribor fixture resolved to ${maribor.name}`);
  assert(searchQueries.length === 0, 'An unambiguous reverse-geocode result must not trigger an Open-Meteo request.');

  const kocevje = await resolve({
    addresses: [address({ city: 'Kočevje', district: 'Kočevje', name: 'Kočevje' })],
    latitude: 45.64323,
    longitude: 14.86036,
  });
  assert(kocevje.name === 'Kočevje', `Kočevje fixture resolved to ${kocevje.name}`);

  const nearer = await resolve({
    addresses: [address({ city: 'Ravne na Koroškem', district: 'Črna na Koroškem' })],
    latitude: 46.472,
    longitude: 14.852,
  });
  assert(nearer.name === 'Črna na Koroškem', 'Nearest candidate was not selected.');

  const adminOnly = await resolve({
    addresses: [address({ region: 'Koroška', country: 'Slovenija', formattedAddress: 'Slovenija' })],
    latitude: 46.47,
    longitude: 14.85,
  });
  assert(adminOnly.name == null && adminOnly.method === 'neutralFallback', 'Administrative-only data must use a neutral fallback.');

  const manual = { name: 'Črna na Koroškem', latitude: 46.47045, longitude: 14.85009, source: 'place' as const };
  assert(manual.name === 'Črna na Koroškem', 'Manual location label must remain authoritative.');

  const finalGps = buildGpsExploreLocation(46.47045, 14.85009, crna);
  assert(finalGps.name === 'Črna na Koroškem', 'A new GPS fix must not retain a stale Ravne label.');
  assert(finalGps.latitude === 46.47045 && finalGps.longitude === 14.85009, 'Resolver must not alter accepted GPS coordinates.');

  const labels = extractLocalityCandidates(crnaAddresses).map((candidate) => candidate.label);
  assert(labels.includes('Črna na Koroškem') && labels.includes('Ravne na Koroškem'), 'Full address fields were not inspected.');
  console.info('Locality resolver smoke tests passed: Črna/Ravne, Maribor, Kočevje, nearest candidate, neutral fallback, manual label, stale-label replacement.');
}

async function runLiveCrossCheck() {
  const resolution = await resolveGpsLocality({
    addresses: [address({ city: 'Ravne na Koroškem', district: 'Črna na Koroškem' })],
    latitude: 46.47045,
    longitude: 14.85009,
  });
  assert(resolution.name === 'Črna na Koroškem', `Live Open-Meteo cross-check resolved to ${resolution.name}`);
  console.info(`Live Open-Meteo cross-check passed: ${resolution.name}, ${resolution.distanceKm?.toFixed(2)} km from fixture GPS.`);
}

const processArgs = (globalThis as typeof globalThis & { process?: { argv?: string[] } }).process?.argv ?? [];
void run().then(() => processArgs.includes('--live') ? runLiveCrossCheck() : undefined);
