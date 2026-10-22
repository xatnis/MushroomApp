import type { HeatmapHabitatState } from '../domain/heatmap/types';
import type { MushroomWeatherProfileId } from '../domain/types';
import { MUSHROOM_WEATHER_PROFILES } from '../domain/mushroomWeather';

/** Display metadata only. Never passed to weather hooks, scorers or habitat resolution. */
export interface ResearchForecastOrigin {
  date: string; cellId: string; profileId: MushroomWeatherProfileId; habitat: HeatmapHabitatState;
  snapshotId: string; contract: string;
}
const date = (d: string) => new Intl.DateTimeFormat('sl-SI', { timeZone: 'Europe/Ljubljana', day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(d + 'T12:00:00Z'));
export function researchPointContext(origin: ResearchForecastOrigin | undefined, dates: string[] | undefined, selected?: string): string[] {
  if (!origin) return [];
  const habitat = origin.habitat === 'candidate' ? 'potencialno primeren' : origin.habitat === 'unknown' ? 'ni potrjen' : 'zunaj habitatnega modela';
  return [
    `Zamrznjen regionalni posnetek: ${date(origin.date)} · ${MUSHROOM_WEATHER_PROFILES[origin.profileId].label}. Raziskovalni habitat celice: ${habitat}.`,
    dates?.length ? `Aktualna napoved točke: ${date(dates[0])}–${date(dates[dates.length - 1])}. ${dates.includes(origin.date)
      ? 'Isti datum ne pomeni istega vremenskega posnetka ali regionalne ocene.'
      : `Raziskovalni datum ni v tem oknu; prikazan je ${selected === dates[0] ? 'Danes' : 'izbrani aktualni datum'}${selected ? ` (${date(selected)})` : ''}, ne ocena za raziskovalni dan.`}`
      : 'Točkovna napoved pridobiva svoj aktualni vremenski posnetek, ne zamrznjenih raziskovalnih podatkov.',
    'Habitat spodaj: produkcijski regionalni indeks, ne zamrznjena raziskovalna celica. Celice, meje, profil ali podatkovni kontekst se lahko razlikujejo. Nobena presoja ne potrjuje habitata na točni koordinati.',
  ];
}
