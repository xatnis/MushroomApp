import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { weatherLocalDate } from '../domain/weatherSeries';

/** Only mounted graphs observe the local calendar. No background polling or transport here. */
export function useWeatherGraphLocalDate() {
  const [today, setToday] = useState(weatherLocalDate);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const check = () => {
      clear();
      if (disposed || (AppState.currentState && AppState.currentState !== 'active')) return;
      setToday(weatherLocalDate());
      // Ljubljana midnight is a minute boundary even across DST. Refresh on resume too.
      timer = setTimeout(check, 60000 - Date.now() % 60000);
    };
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); else clear(); });
    check();
    return () => { disposed = true; clear(); subscription.remove(); };
  }, []);
  return today;
}
