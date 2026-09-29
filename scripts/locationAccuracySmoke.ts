import type { LocationObject } from 'expo-location';
import {
  FRESH_MAX_ACCEPTABLE_ACCURACY_M,
  FRESH_PREFERRED_ACCURACY_M,
  LAST_KNOWN_LOCATION_MAX_AGE_MS,
  LAST_KNOWN_LOCATION_REQUIRED_ACCURACY_M,
  LocationAcquisitionError,
  acquireForegroundPosition,
  accuracyMeters,
  createLocationRequestGate,
  isAcceptableFreshLocation,
  isAcceptableLastKnownLocation,
  selectMoreAccurateLocation,
  type LocationApi,
} from '../src/services/location';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const location = (accuracy: number | null, ageMs = 0): LocationObject => ({
  coords: {
    latitude: 46.47,
    longitude: 14.85,
    altitude: null,
    accuracy,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  },
  timestamp: Date.now() - ageMs,
});

const best = [location(427), location(180), location(62)]
  .reduce<LocationObject | undefined>(selectMoreAccurateLocation, undefined);
assert(accuracyMeters(best as LocationObject) === 62, '427 → 180 → 62 must retain the 62 m fix.');
assert(!isAcceptableFreshLocation(location(427)), 'A 427 m fresh fix must be rejected.');
assert(isAcceptableFreshLocation(location(180)), 'A 180 m best fix may be accepted at timeout.');
assert(!isAcceptableFreshLocation(location(310)), 'A 310 m best fix must be rejected.');

const now = Date.now();
assert(
  !isAcceptableLastKnownLocation(location(40, LAST_KNOWN_LOCATION_MAX_AGE_MS + 1), now),
  'An old 40 m last-known fix must be rejected by age.',
);
assert(
  isAcceptableLastKnownLocation(location(80, 60_000), now),
  'A recent 80 m last-known fix must pass the shared fallback policy.',
);
assert(
  !isAcceptableLastKnownLocation(location(LAST_KNOWN_LOCATION_REQUIRED_ACCURACY_M + 1, 60_000), now),
  'An inaccurate last-known fix must be rejected even when recent.',
);

const gate = createLocationRequestGate();
const firstRequest = gate.begin();
assert(firstRequest, 'The first GPS request should start.');
assert(gate.begin() == null, 'A rapid second request must not create another watcher.');
gate.finish(firstRequest);
assert(gate.begin(), 'A retry must be possible after the first request finishes.');
gate.cancel();

const mockApi = (fixes: LocationObject[], fallback: LocationObject | null = null) => {
  let removed = 0;
  let requestedAccuracy: number | undefined;
  const api = {
    getForegroundPermissionsAsync: async () => ({ granted: true, canAskAgain: true, android: { accuracy: 'fine' } }),
    requestForegroundPermissionsAsync: async () => ({ granted: true, canAskAgain: true, android: { accuracy: 'fine' } }),
    hasServicesEnabledAsync: async () => true,
    getProviderStatusAsync: async () => ({ locationServicesEnabled: true, gpsAvailable: true, networkAvailable: true, passiveAvailable: true }),
    getLastKnownPositionAsync: async () => fallback,
    watchPositionAsync: async (options: { accuracy?: number }, callback: (fix: LocationObject) => void) => {
      requestedAccuracy = options.accuracy;
      for (const fix of fixes) callback(fix);
      return { remove: () => { removed += 1; } };
    },
  } as unknown as LocationApi;
  return { api, stats: () => ({ removed, requestedAccuracy }) };
};

async function run() {
  const improving = mockApi([location(427), location(180), location(62)]);
  const accepted = await acquireForegroundPosition(improving.api, 5, 15);
  assert(accuracyMeters(accepted.location) === 62, 'Acquisition must accept the best 62 m fix, not the first fix.');
  assert(accepted.fixCount === 3, 'All improving fixes must be observed.');
  assert(improving.stats().requestedAccuracy === 5, 'The requested Expo accuracy must reach watchPositionAsync.');
  assert(improving.stats().removed === 1, 'The watcher must be removed after acquisition.');

  const rejected = mockApi([location(427)]);
  let rejectedError: LocationAcquisitionError | undefined;
  try {
    await acquireForegroundPosition(rejected.api, 5, 5);
  } catch (error) {
    rejectedError = error as LocationAcquisitionError;
  }
  assert(rejectedError?.code === 'qualityUnavailable', 'A 427 m-only acquisition must fail the quality gate.');
  assert(rejectedError.bestAccuracyM === 427, 'The rejection must retain the best achieved accuracy.');
  assert(rejectedError.message.includes('±427 m'), 'The user error must report the best achieved accuracy.');

  const acceptableAtTimeout = mockApi([location(180)]);
  const timeoutAccepted = await acquireForegroundPosition(acceptableAtTimeout.api, 5, 5);
  assert(
    timeoutAccepted.source === 'fresh' && accuracyMeters(timeoutAccepted.location) === 180,
    'The best 180 m live fix must be accepted at timeout with its real accuracy.',
  );

  const tooCoarseAtTimeout = mockApi([location(310)]);
  await acquireForegroundPosition(tooCoarseAtTimeout.api, 5, 5).then(
    () => { throw new Error('A 310 m live fix must not be accepted.'); },
    (error: LocationAcquisitionError) => {
      assert(error.code === 'qualityUnavailable' && error.bestAccuracyM === 310, 'A 310 m timeout must report a quality rejection.');
    },
  );

  const oldFallback = mockApi([location(427)], location(40, LAST_KNOWN_LOCATION_MAX_AGE_MS + 1));
  await acquireForegroundPosition(oldFallback.api, 5, 5).then(
    () => { throw new Error('An old last-known location must not be accepted.'); },
    (error: LocationAcquisitionError) => {
      assert(error.code === 'qualityUnavailable', 'An old fallback must preserve the location-quality failure.');
    },
  );

  const recentFallback = mockApi([location(427)], location(80, 60_000));
  const fallbackAccepted = await acquireForegroundPosition(recentFallback.api, 5, 5);
  assert(
    fallbackAccepted.source === 'lastKnown' && accuracyMeters(fallbackAccepted.location) === 80,
    'A recent, accurate last-known fix must be accepted only after the live acquisition fails.',
  );

  console.info('Location accuracy smoke tests passed', {
    preferredAccuracyM: FRESH_PREFERRED_ACCURACY_M,
    maximumAcceptedAccuracyM: FRESH_MAX_ACCEPTABLE_ACCURACY_M,
    lastKnownMaximumAgeMs: LAST_KNOWN_LOCATION_MAX_AGE_MS,
    lastKnownMaximumAccuracyM: LAST_KNOWN_LOCATION_REQUIRED_ACCURACY_M,
  });
}

void run();
