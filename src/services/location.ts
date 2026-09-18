import type { LocationObject } from 'expo-location';

type LocationApi = Pick<typeof import('expo-location'),
  | 'getForegroundPermissionsAsync'
  | 'requestForegroundPermissionsAsync'
  | 'hasServicesEnabledAsync'
  | 'getCurrentPositionAsync'
  | 'getLastKnownPositionAsync'
>;

export const CURRENT_LOCATION_TIMEOUT_MS = 12_000;
export const LAST_KNOWN_LOCATION_MAX_AGE_MS = 15 * 60_000;
export const LAST_KNOWN_LOCATION_REQUIRED_ACCURACY_M = 1_000;
export const LAST_KNOWN_LOCATION_TIMEOUT_MS = 3_000;

export interface ForegroundPositionResult {
  location: LocationObject;
  source: 'current' | 'lastKnown';
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  promise.then(
    (value) => { clearTimeout(timeout); resolve(value); },
    (error) => { clearTimeout(timeout); reject(error); },
  );
});

export async function acquireForegroundPosition(
  locationApi: LocationApi,
  accuracy: number,
  timeoutMs = CURRENT_LOCATION_TIMEOUT_MS,
): Promise<ForegroundPositionResult> {
  let permission = await locationApi.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain !== false) {
    permission = await locationApi.requestForegroundPermissionsAsync();
  }
  if (!permission.granted) {
    throw new Error('Dovoljenje za trenutno lokacijo ni odobreno. Izberite kraj ročno.');
  }

  if (!await locationApi.hasServicesEnabledAsync()) {
    throw new Error('Lokacijske storitve so izklopljene. Vključite GPS ali izberite kraj ročno.');
  }

  try {
    const location = await withTimeout(
      locationApi.getCurrentPositionAsync({ accuracy }),
      timeoutMs,
      'Lokacije ni bilo mogoče pravočasno pridobiti.',
    );
    return { location, source: 'current' };
  } catch (currentError) {
    try {
      const location = await withTimeout(
        locationApi.getLastKnownPositionAsync({
          maxAge: LAST_KNOWN_LOCATION_MAX_AGE_MS,
          requiredAccuracy: LAST_KNOWN_LOCATION_REQUIRED_ACCURACY_M,
        }),
        LAST_KNOWN_LOCATION_TIMEOUT_MS,
        'Zadnje znane lokacije ni bilo mogoče pridobiti.',
      );
      if (location) return { location, source: 'lastKnown' };
    } catch {
      // Preserve the current-position failure below; last-known data is only a fallback.
    }
    if (currentError instanceof Error && currentError.message === 'Lokacije ni bilo mogoče pravočasno pridobiti.') {
      throw currentError;
    }
    throw new Error('Lokacije ni bilo mogoče pridobiti. Poskusite znova ali izberite kraj ročno.');
  }
}
