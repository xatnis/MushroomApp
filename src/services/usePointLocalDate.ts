import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { weatherLocalDate } from '../domain/weatherSeries';
import { civilDailyPeriod } from '../domain/soilSampling';

/** True civil midnight/resume rollover, not elapsed +24h or a profile/location reset. */
export function usePointLocalDate() {
  const [date, setDate] = useState(weatherLocalDate());
  useEffect(() => {
    const refresh = () => setDate(weatherLocalDate());
    const midnight = Date.parse(civilDailyPeriod(date).endUtc ?? '');
    const timer = Number.isFinite(midnight) ? setTimeout(refresh, Math.max(1, midnight - Date.now())) : undefined;
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { if (timer != null) clearTimeout(timer); subscription.remove(); };
  }, [date]);
  return date;
}
