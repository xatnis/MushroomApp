import type {
  LocationObject,
  LocationPermissionResponse,
  LocationProviderStatus,
  LocationSubscription,
} from 'expo-location';

type LocationApi = Pick<typeof import('expo-location'),
  | 'getForegroundPermissionsAsync'
  | 'requestForegroundPermissionsAsync'
  | 'hasServicesEnabledAsync'
  | 'getProviderStatusAsync'
  | 'watchPositionAsync'
  | 'getLastKnownPositionAsync'
>;

export const FRESH_PREFERRED_ACCURACY_M = 100;
export const FRESH_MAX_ACCEPTABLE_ACCURACY_M = 250;
export const CURRENT_LOCATION_TIMEOUT_MS = 20_000;
export const LAST_KNOWN_LOCATION_MAX_AGE_MS = 15 * 60_000;
export const LAST_KNOWN_LOCATION_REQUIRED_ACCURACY_M = 250;
export const LAST_KNOWN_LOCATION_TIMEOUT_MS = 3_000;

type AndroidPermissionAccuracy = NonNullable<LocationPermissionResponse['android']>['accuracy'];

export type LocationAcquisitionErrorCode =
  | 'cancelled'
  | 'permissionDenied'
  | 'precisePermissionRequired'
  | 'servicesDisabled'
  | 'qualityUnavailable';

export class LocationAcquisitionError extends Error {
  constructor(
    message: string,
    public readonly code: LocationAcquisitionErrorCode,
    public readonly settingsRequired = false,
  ) {
    super(message);
    this.name = 'LocationAcquisitionError';
  }
}

export interface ForegroundPositionResult {
  location: LocationObject;
  source: 'fresh' | 'lastKnown';
  permissionAccuracy?: AndroidPermissionAccuracy;
  providerStatus?: LocationProviderStatus;
}

const locationDebug = (event: string, details: Record<string, unknown>) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.info(`[Location] ${event}`, details);
};

const accuracyMeters = (location: LocationObject) => {
  const accuracy = location.coords.accuracy;
  return typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : undefined;
};

const locationAgeMs = (location: LocationObject) => Math.max(0, Date.now() - location.timestamp);

const isWithinAccuracy = (location: LocationObject, maximumMeters: number) => {
  const accuracy = accuracyMeters(location);
  return accuracy != null && accuracy <= maximumMeters;
};

const cancelledError = () => new LocationAcquisitionError('Lokacijski zahtevek je bil preklican.', 'cancelled');

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw cancelledError();
};

const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    action();
  };
  const onAbort = () => finish(() => reject(cancelledError()));
  const timeout = setTimeout(() => finish(() => reject(new Error(message))), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  promise.then(
    (value) => finish(() => resolve(value)),
    (error) => finish(() => reject(error)),
  );
});

const watchForFreshPosition = (
  locationApi: LocationApi,
  accuracy: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<LocationObject> => new Promise((resolve, reject) => {
  let settled = false;
  let subscription: LocationSubscription | undefined;
  let bestLocation: LocationObject | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    subscription?.remove();
    subscription = undefined;
  };
  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    cleanup();
    action();
  };
  const finishWithBestOrError = () => {
    if (bestLocation && isWithinAccuracy(bestLocation, FRESH_MAX_ACCEPTABLE_ACCURACY_M)) {
      finish(() => resolve(bestLocation as LocationObject));
      return;
    }
    finish(() => reject(new LocationAcquisitionError(
      'Natančne lokacije ni bilo mogoče določiti. Poskusite znova ali izberite kraj ročno.',
      'qualityUnavailable',
    )));
  };
  const onAbort = () => finish(() => reject(cancelledError()));

  timeout = setTimeout(finishWithBestOrError, timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
    return;
  }

  void locationApi.watchPositionAsync(
    {
      accuracy,
      mayShowUserSettingsDialog: true,
      timeInterval: 1_000,
      distanceInterval: 0,
    },
    (location) => {
      if (settled) return;
      const nextAccuracy = accuracyMeters(location);
      const bestAccuracy = bestLocation ? accuracyMeters(bestLocation) : undefined;
      if (nextAccuracy != null && (bestAccuracy == null || nextAccuracy < bestAccuracy)) bestLocation = location;
      locationDebug('fresh-fix', {
        source: 'fresh',
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracyM: nextAccuracy,
        ageMs: locationAgeMs(location),
      });
      if (isWithinAccuracy(location, FRESH_PREFERRED_ACCURACY_M)) finish(() => resolve(location));
    },
    (reason) => {
      locationDebug('watch-error', { reason });
      finishWithBestOrError();
    },
  ).then((nextSubscription) => {
    if (settled) {
      nextSubscription.remove();
      return;
    }
    subscription = nextSubscription;
  }).catch((error) => {
    locationDebug('watch-start-error', { error: error instanceof Error ? error.message : String(error) });
    finishWithBestOrError();
  });
});

export async function acquireForegroundPosition(
  locationApi: LocationApi,
  accuracy: number,
  timeoutMs = CURRENT_LOCATION_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<ForegroundPositionResult> {
  throwIfAborted(signal);
  let permission = await locationApi.getForegroundPermissionsAsync();
  throwIfAborted(signal);
  if (!permission.granted && permission.canAskAgain !== false) {
    permission = await locationApi.requestForegroundPermissionsAsync();
    throwIfAborted(signal);
  }

  const permissionAccuracy = permission.android?.accuracy;
  locationDebug('permission', {
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    androidAccuracy: permissionAccuracy,
  });
  if (!permission.granted) {
    const settingsRequired = permission.canAskAgain === false;
    throw new LocationAcquisitionError(
      settingsRequired
        ? 'Dostop do lokacije je izklopljen. Omogočite ga v nastavitvah aplikacije ali izberite kraj ročno.'
        : 'Dovoljenje za trenutno lokacijo ni odobreno. Izberite kraj ročno.',
      'permissionDenied',
      settingsRequired,
    );
  }
  if (permissionAccuracy === 'coarse' || permissionAccuracy === 'none') {
    throw new LocationAcquisitionError(
      'Za natančno možnost »Moja lokacija« omogočite natančno lokacijo v nastavitvah aplikacije. Ročna izbira kraja ostaja na voljo.',
      'precisePermissionRequired',
      true,
    );
  }

  let providerStatus: LocationProviderStatus | undefined;
  try {
    providerStatus = await locationApi.getProviderStatusAsync();
  } catch (error) {
    locationDebug('provider-status-error', { error: error instanceof Error ? error.message : String(error) });
  }
  throwIfAborted(signal);
  const servicesEnabled = providerStatus?.locationServicesEnabled ?? await locationApi.hasServicesEnabledAsync();
  locationDebug('providers', {
    locationServicesEnabled: servicesEnabled,
    gpsAvailable: providerStatus?.gpsAvailable,
    networkAvailable: providerStatus?.networkAvailable,
    passiveAvailable: providerStatus?.passiveAvailable,
  });
  if (!servicesEnabled) {
    throw new LocationAcquisitionError(
      'Lokacijske storitve so izklopljene. Vključite GPS ali izberite kraj ročno.',
      'servicesDisabled',
    );
  }

  try {
    const location = await watchForFreshPosition(locationApi, accuracy, timeoutMs, signal);
    locationDebug('accepted', {
      source: 'fresh',
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracyM: accuracyMeters(location),
      ageMs: locationAgeMs(location),
      permissionAccuracy,
    });
    return { location, source: 'fresh', permissionAccuracy, providerStatus };
  } catch (currentError) {
    throwIfAborted(signal);
    try {
      const location = await withTimeout(
        locationApi.getLastKnownPositionAsync({
          maxAge: LAST_KNOWN_LOCATION_MAX_AGE_MS,
          requiredAccuracy: LAST_KNOWN_LOCATION_REQUIRED_ACCURACY_M,
        }),
        LAST_KNOWN_LOCATION_TIMEOUT_MS,
        'Zadnje znane lokacije ni bilo mogoče pridobiti.',
        signal,
      );
      throwIfAborted(signal);
      if (
        location
        && locationAgeMs(location) <= LAST_KNOWN_LOCATION_MAX_AGE_MS
        && isWithinAccuracy(location, LAST_KNOWN_LOCATION_REQUIRED_ACCURACY_M)
      ) {
        locationDebug('accepted', {
          source: 'lastKnown',
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracyM: accuracyMeters(location),
          ageMs: locationAgeMs(location),
          permissionAccuracy,
        });
        return { location, source: 'lastKnown', permissionAccuracy, providerStatus };
      }
      locationDebug('last-known-rejected', {
        source: 'lastKnown',
        latitude: location?.coords.latitude,
        longitude: location?.coords.longitude,
        accuracyM: location ? accuracyMeters(location) : undefined,
        ageMs: location ? locationAgeMs(location) : undefined,
      });
    } catch (fallbackError) {
      if (fallbackError instanceof LocationAcquisitionError && fallbackError.code === 'cancelled') throw fallbackError;
      locationDebug('last-known-error', { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) });
    }
    locationDebug('acquisition-failed', { currentError: currentError instanceof Error ? currentError.message : String(currentError) });
    throw new LocationAcquisitionError(
      'Natančne lokacije ni bilo mogoče določiti. Poskusite znova ali izberite kraj ročno.',
      'qualityUnavailable',
    );
  }
}
