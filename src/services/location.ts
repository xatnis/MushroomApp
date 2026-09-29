import type {
  LocationObject,
  LocationPermissionResponse,
  LocationProviderStatus,
  LocationSubscription,
} from 'expo-location';

export type LocationApi = Pick<typeof import('expo-location'),
  | 'getForegroundPermissionsAsync'
  | 'requestForegroundPermissionsAsync'
  | 'hasServicesEnabledAsync'
  | 'getProviderStatusAsync'
  | 'watchPositionAsync'
  | 'getLastKnownPositionAsync'
> & Partial<Pick<typeof import('expo-location'), 'enableNetworkProviderAsync'>>;

export const FRESH_EXCELLENT_ACCURACY_M = 50;
export const FRESH_PREFERRED_ACCURACY_M = 100;
export const FRESH_MAX_ACCEPTABLE_ACCURACY_M = 250;
export const CURRENT_LOCATION_TIMEOUT_MS = 20_000;
export const FRESH_PREFERRED_SETTLE_MS = 1_500;
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
    public readonly bestAccuracyM?: number,
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
  fixCount: number;
  acquisitionDurationMs: number;
}

export interface LocationRequestGate {
  begin(): AbortController | undefined;
  finish(controller: AbortController): void;
  cancel(): void;
  isActive(): boolean;
}

export function createLocationRequestGate(): LocationRequestGate {
  let active: AbortController | undefined;
  return {
    begin() {
      if (active && !active.signal.aborted) return undefined;
      active = new AbortController();
      return active;
    },
    finish(controller) {
      if (active === controller) active = undefined;
    },
    cancel() {
      active?.abort();
      active = undefined;
    },
    isActive: () => Boolean(active && !active.signal.aborted),
  };
}

const locationDebug = (event: string, details: Record<string, unknown>) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.info(`[Location] ${event}`, details);
};

export const accuracyMeters = (location: LocationObject) => {
  const accuracy = location.coords.accuracy;
  return typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : undefined;
};

export const locationAgeMs = (location: LocationObject, now = Date.now()) => Math.max(0, now - location.timestamp);

const isWithinAccuracy = (location: LocationObject, maximumMeters: number) => {
  const accuracy = accuracyMeters(location);
  return accuracy != null && accuracy <= maximumMeters;
};

export const selectMoreAccurateLocation = (
  current: LocationObject | undefined,
  candidate: LocationObject,
) => {
  const currentAccuracy = current ? accuracyMeters(current) : undefined;
  const candidateAccuracy = accuracyMeters(candidate);
  if (candidateAccuracy == null) return current;
  return currentAccuracy == null || candidateAccuracy < currentAccuracy ? candidate : current;
};

export const isAcceptableFreshLocation = (location: LocationObject | undefined) => (
  Boolean(location && isWithinAccuracy(location, FRESH_MAX_ACCEPTABLE_ACCURACY_M))
);

export const isAcceptableLastKnownLocation = (
  location: LocationObject | null | undefined,
  now = Date.now(),
) => Boolean(
  location
  && locationAgeMs(location, now) <= LAST_KNOWN_LOCATION_MAX_AGE_MS
  && isWithinAccuracy(location, LAST_KNOWN_LOCATION_REQUIRED_ACCURACY_M),
);

const qualityUnavailableError = (bestAccuracyM?: number) => new LocationAcquisitionError(
  bestAccuracyM == null
    ? 'Natančne lokacije trenutno ni mogoče določiti. Poskusite znova ali izberite lokacijo ročno.'
    : `Natančne lokacije trenutno ni mogoče določiti. Najboljša dosežena natančnost: ±${Math.round(bestAccuracyM)} m. Poskusite znova ali izberite lokacijo ročno.`,
  'qualityUnavailable',
  false,
  bestAccuracyM,
);

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
): Promise<{ location: LocationObject; fixCount: number; durationMs: number }> => new Promise((resolve, reject) => {
  let settled = false;
  let subscription: LocationSubscription | undefined;
  let bestLocation: LocationObject | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let preferredSettleTimeout: ReturnType<typeof setTimeout> | undefined;
  let fixCount = 0;
  const startedAt = Date.now();

  const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    if (preferredSettleTimeout) clearTimeout(preferredSettleTimeout);
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
    if (isAcceptableFreshLocation(bestLocation)) {
      const location = bestLocation as LocationObject;
      finish(() => resolve({ location, fixCount, durationMs: Date.now() - startedAt }));
      return;
    }
    finish(() => reject(qualityUnavailableError(bestLocation ? accuracyMeters(bestLocation) : undefined)));
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
      fixCount += 1;
      const nextAccuracy = accuracyMeters(location);
      bestLocation = selectMoreAccurateLocation(bestLocation, location);
      locationDebug('fresh-fix', {
        source: 'fresh',
        accuracyM: nextAccuracy,
        ageMs: locationAgeMs(location),
        fixCount,
        durationMs: Date.now() - startedAt,
      });
      if (isWithinAccuracy(location, FRESH_EXCELLENT_ACCURACY_M)) {
        const accepted = bestLocation as LocationObject;
        finish(() => resolve({ location: accepted, fixCount, durationMs: Date.now() - startedAt }));
      } else if (isWithinAccuracy(location, FRESH_PREFERRED_ACCURACY_M) && !preferredSettleTimeout) {
        preferredSettleTimeout = setTimeout(finishWithBestOrError, Math.min(FRESH_PREFERRED_SETTLE_MS, timeoutMs));
      }
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
  const acquisitionStartedAt = Date.now();
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
  let servicesEnabled = providerStatus?.locationServicesEnabled ?? await locationApi.hasServicesEnabledAsync();
  if (!servicesEnabled && locationApi.enableNetworkProviderAsync) {
    try {
      await locationApi.enableNetworkProviderAsync();
      providerStatus = await locationApi.getProviderStatusAsync();
      servicesEnabled = providerStatus.locationServicesEnabled;
    } catch (error) {
      locationDebug('enable-provider-error', { error: error instanceof Error ? error.message : String(error) });
    }
  }
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
    const fresh = await watchForFreshPosition(locationApi, accuracy, timeoutMs, signal);
    const { location } = fresh;
    locationDebug('accepted', {
      source: 'fresh',
      accuracyM: accuracyMeters(location),
      ageMs: locationAgeMs(location),
      permissionAccuracy,
      fixCount: fresh.fixCount,
      durationMs: fresh.durationMs,
      reason: isWithinAccuracy(location, FRESH_PREFERRED_ACCURACY_M) ? 'preferredAccuracy' : 'bestAtTimeout',
    });
    return {
      location,
      source: 'fresh',
      permissionAccuracy,
      providerStatus,
      fixCount: fresh.fixCount,
      acquisitionDurationMs: fresh.durationMs,
    };
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
      if (isAcceptableLastKnownLocation(location)) {
        const accepted = location as LocationObject;
        locationDebug('accepted', {
          source: 'lastKnown',
          accuracyM: accuracyMeters(accepted),
          ageMs: locationAgeMs(accepted),
          permissionAccuracy,
          fixCount: 0,
          durationMs: Date.now() - acquisitionStartedAt,
          reason: 'freshAndAccurateFallback',
        });
        return {
          location: accepted,
          source: 'lastKnown',
          permissionAccuracy,
          providerStatus,
          fixCount: 0,
          acquisitionDurationMs: Date.now() - acquisitionStartedAt,
        };
      }
      locationDebug('last-known-rejected', {
        source: 'lastKnown',
        accuracyM: location ? accuracyMeters(location) : undefined,
        ageMs: location ? locationAgeMs(location) : undefined,
        reason: location ? 'ageOrAccuracyGate' : 'unavailable',
      });
    } catch (fallbackError) {
      if (fallbackError instanceof LocationAcquisitionError && fallbackError.code === 'cancelled') throw fallbackError;
      locationDebug('last-known-error', { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) });
    }
    const currentBestAccuracy = currentError instanceof LocationAcquisitionError
      ? currentError.bestAccuracyM
      : undefined;
    locationDebug('acquisition-failed', {
      currentError: currentError instanceof Error ? currentError.message : String(currentError),
      bestAccuracyM: currentBestAccuracy,
      durationMs: Date.now() - acquisitionStartedAt,
    });
    throw qualityUnavailableError(currentBestAccuracy);
  }
}
