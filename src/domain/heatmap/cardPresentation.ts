import { slNumber } from '../format';
import type { MushroomScoreComponent } from '../types';
import type { HeatmapAreaAssessment } from './types';

export type FactorKey = 'rain' | 'temperature' | 'soilMoisture' | 'drying';
export interface CardFactor { key: FactorKey; label: string; status: string; ratio?: number; mixed: boolean; detail: string; compactDetail: string; detailedStatus: string }
// DISPLAY bands only. Component value=1 is favourable, including drying (inverse deficit).
// These never alter weather weights, ecological thresholds, published score or habitat state.
export const FACTOR_DISPLAY_BANDS = { veryFavourable: .85, favourable: .65, moderate: .40 } as const;
export const RAIN_DISPLAY_DISAGREEMENT = .45;
export function factorBand(ratio?: number): number {
  if (ratio == null || !Number.isFinite(ratio)) return -1;
  return ratio >= FACTOR_DISPLAY_BANDS.veryFavourable ? 3 : ratio >= FACTOR_DISPLAY_BANDS.favourable ? 2 : ratio >= FACTOR_DISPLAY_BANDS.moderate ? 1 : 0;
}
const isRain = (c: MushroomScoreComponent) => c.key.startsWith('rain');
const value = (number: number | undefined, unit: string, digits = 1) => number == null || !Number.isFinite(number)
  ? 'ni podatka' : `${slNumber(number, digits)} ${unit}`;
const rainDays = (key: string) => Number(key.replace('rain', ''));

export function compactCardMetadata(areaDetails: string | undefined, speciesLabel: string): string {
  // Only omit the redundant domestic country in the header; full metadata stays in Details.
  const region = areaDetails?.trim().replace(/,\s*(Slovenija|Slovenia)$/i, '');
  return region ? `${region} · ${speciesLabel}` : speciesLabel;
}

export function cardFactors(a: HeatmapAreaAssessment): CardFactor[] {
  const components = a.scoreDetails.components;
  const h = a.summary.historical, current = a.summary.current;
  return (['rain', 'temperature', 'soilMoisture', 'drying'] as const).map(key => {
    const group = components.filter(c => (key === 'rain' ? isRain(c) : c.key === key)
      && Number.isFinite(c.value) && Number.isFinite(c.weight) && c.weight > 0);
    const weight = group.reduce((sum, c) => sum + c.weight, 0);
    const ratio = weight ? group.reduce((sum, c) => sum + c.value * c.weight, 0) / weight : undefined;
    // Wide disagreement in suitability is surfaced instead of hiding a dry recent window behind a wet long one.
    const mixed = key === 'rain' && group.length > 1
      && Math.max(...group.map(c => c.value)) - Math.min(...group.map(c => c.value)) >= RAIN_DISPLAY_DISAGREEMENT;
    const labels = key === 'rain' ? ['Neugodne', 'Zmerno ugodne', 'Ugodne', 'Zelo ugodne']
      : key === 'drying' ? ['Neugodno', 'Manj ugodno', 'Ugodno', 'Zelo ugodno']
        : ['Neugodna', 'Zmerno ugodna', 'Ugodna', 'Zelo ugodna'];
    const band = factorBand(ratio);
    let detail = 'Za ta dejavnik ni dovolj podatkov.';
    if (band >= 0 && key === 'rain') {
      detail = group.map(c => c.key === 'rain'
        ? `Padavine v zadnjih 7 / 14 / 30 dneh: ${value(h?.rain7dMm, 'mm')} / ${value(h?.rain14dMm, 'mm')} / ${value(h?.rain30dMm, 'mm')}.`
        : `${value(h?.[`rain${rainDays(c.key)}dMm` as keyof NonNullable<typeof h>] as number | undefined, 'mm')} v zadnjih ${rainDays(c.key)} dneh`).join(' · ');
    } else if (band >= 0 && key === 'temperature') {
      const days = a.speciesId === 'cantharellusCibarius' ? 14 : 20;
      detail = `Povprečje ${value(days === 14 ? h?.avgTemp14dC : h?.avgTemp20dC, '°C')} v zadnjih ${days} dneh`;
    } else if (band >= 0 && key === 'soilMoisture') {
      detail = band >= 2 ? 'Vlaga tal je ugodna za izbrani vremenski profil.' : 'Vlaga tal je manj ugodna za izbrani vremenski profil.';
      if (current?.soilMoisture0To7Cm == null || current?.soilMoisture7To28Cm == null) detail += ' Ena plast tal ni na voljo.';
    } else if (band >= 0 && key === 'drying') {
      detail = h?.evapotranspiration7dMm != null && h.rain7dMm != null && h.evapotranspiration7dMm > h.rain7dMm
        ? 'V zadnjem tednu je bilo več izhlapevanja kot novih padavin.'
        : 'Padavine v zadnjem tednu uravnavajo vpliv izhlapevanja.';
    }
    let compactDetail = 'Ni dovolj podatkov.';
    if (band >= 0 && key === 'rain') {
      compactDetail = group.map(c => c.key === 'rain'
        ? `7 / 14 / 30 dni: ${[h?.rain7dMm, h?.rain14dMm, h?.rain30dMm].map(n => n == null ? '—' : slNumber(n, 1)).join(' / ')} mm`
        : `${value(h?.[`rain${rainDays(c.key)}dMm` as keyof NonNullable<typeof h>] as number | undefined, 'mm')} / ${rainDays(c.key)} dni`).join(' · ');
    } else if (band >= 0 && key === 'temperature') {
      const days = a.speciesId === 'cantharellusCibarius' ? 14 : 20;
      compactDetail = `${value(days === 14 ? h?.avgTemp14dC : h?.avgTemp20dC, '°C')} / ${days} dni`;
    } else if (band >= 0 && key === 'soilMoisture') {
      compactDetail = band >= 2 ? 'Vlaga tal ustreza profilu.' : 'Vlaga tal manj ustreza profilu.';
      if (current?.soilMoisture0To7Cm == null || current?.soilMoisture7To28Cm == null) compactDetail += ' Ena plast manjka.';
    } else if (band >= 0 && key === 'drying') {
      compactDetail = h?.evapotranspiration7dMm != null && h.rain7dMm != null && h.evapotranspiration7dMm > h.rain7dMm
        ? 'Več izhlapevanja kot dežja v 7 dneh.' : 'Dež uravnava izhlapevanje v 7 dneh.';
    }
    const status = mixed ? 'Mešani signali' : band < 0 ? 'Ni podatkov' : labels[band];
    const detailedStatus = key === 'drying' && band >= 0 ? ['Močan neugoden vpliv', 'Povečan vpliv', 'Zmeren vpliv', 'Majhen vpliv'][band] : status;
    return { key, label: { rain: 'Padavine', temperature: 'Temperatura', soilMoisture: 'Vlaga tal', drying: 'Izsuševanje' }[key],
      ratio, mixed, status, detail, compactDetail, detailedStatus };
  });
}

export function cardSummary(a: HeatmapAreaAssessment, factors = cardFactors(a)): string {
  if (a.score == null || a.dataQuality === 'insufficient') return 'Za vremensko oceno trenutno ni dovolj podatkov. Habitat lahko preverite spodaj.';
  const rain = factors[0], temperature = factors[1], soil = factors[2], drying = factors[3];
  const good = (f: CardFactor) => factorBand(f.ratio) >= 2;
  const first = rain.ratio == null || temperature.ratio == null ? 'Za skupno razlago padavin in temperature ni dovolj podatkov.'
    : rain.mixed ? 'Padavinski signali so mešani.'
    : good(rain) && good(temperature) ? `Padavine in temperatura so ${factorBand(rain.ratio) === 3 && factorBand(temperature.ratio) === 3 ? 'zelo ugodne' : 'ugodne'}.`
      : good(temperature) && rain.ratio != null ? 'Temperature so primerne, vendar so padavine manj ugodne za izbrani profil.'
        : good(rain) && temperature.ratio != null ? 'Padavine so ugodne, vendar temperatura manj ustreza izbranemu profilu.'
          : 'Razpoložljivi vremenski dejavniki so manj ugodni za izbrani profil.';
  const second = a.dataQuality === 'limited' ? 'Del vremenskih podatkov manjka.'
    : factorBand(drying.ratio) === 0 ? 'Izsuševanje zmanjšuje ugodnost razmer.'
      : good(soil) ? 'Tla so dovolj vlažna za ta vremenski profil.'
        : soil.ratio != null ? 'Vlaga tal je manj ugodna.' : 'Podatki o vlagi tal niso na voljo.';
  return `${first} ${second}`;
}

export function cardHabitat(a: HeatmapAreaAssessment) {
  if (a.habitatState === 'outside-model') return { title: 'Zunaj habitatnega modela', explanation: 'Območje nima dovolj ustreznega vegetacijskega oziroma drevesnega pokrova za ta habitatni model.' };
  if (a.habitatState === 'candidate') return { title: 'Potencialno ustrezno območje', explanation:
    a.speciesId === 'boletusEdulis' ? 'Na območju so potrjene drevesne skupine, povezane z jesenskim gobanom.'
      : a.speciesId === 'cantharellusCibarius' ? 'Potrjene so drevesne skupine, s katerimi je navadna lisička lahko povezana.'
        : a.speciesId === 'lactariusDeliciosus' ? 'ZGS podatki potrjujejo prisotnost bora v delu območja.'
          : 'Območje ima dovolj vegetacijskega pokrova za splošno vremensko oceno.' };
  return { title: a.speciesId === 'lactariusDeliciosus' ? 'Bor ni dovolj potrjen'
    : a.speciesId === 'generic' ? 'Habitat ni potrjen' : 'Gostiteljska drevesa niso dovolj potrjena',
    explanation: a.speciesId === 'generic' ? 'Za zanesljivo razlago habitatnega pokrova ni dovolj podatkov.'
      : !a.treeCompositionSource ? 'Za to območje ni dovolj podatkov o drevesni sestavi.'
      : a.speciesId === 'lactariusDeliciosus' ? 'Območje je gozdnato, vendar podatki ne potrjujejo dovolj zanesljivo prisotnosti bora.'
        : 'Območje je gozdnato, vendar podatki o drevesni sestavi niso dovolj popolni za zanesljivo habitatno oceno.' };
}

export function cardReliability(a: HeatmapAreaAssessment, pending = false) {
  const unknown = a.habitatState === 'unknown';
  const partialSoil = a.scoreDetails.components.some(c => c.key === 'soilMoisture')
    && (a.summary.current?.soilMoisture0To7Cm == null || a.summary.current?.soilMoisture7To28Cm == null);
  const level = pending || a.score == null || a.dataQuality === 'insufficient' || (unknown && a.dataQuality === 'limited')
    ? 'Omejena' : a.dataQuality === 'limited' || unknown || a.summary.stale || partialSoil ? 'Srednja' : 'Visoka';
  const explanation = level === 'Visoka' ? 'Na voljo so vsi glavni vremenski podatki in dovolj podatkov o območju.'
    : level === 'Srednja' ? 'Del podatkov je omejen, vendar je ocena še vedno uporabna.'
      : 'Za del vremenskih ali habitatnih podatkov ni dovolj informacij.';
  const compactExplanation = level === 'Visoka' ? 'Na voljo so vsi glavni podatki.'
    : level === 'Srednja' ? 'Del podatkov je omejen.' : 'Za del ocene ni dovolj podatkov.';
  return { level, explanation, compactExplanation };
}

export function cardTechnicalDetails(a: HeatmapAreaAssessment) {
  const h = a.summary.historical, c = a.summary.current;
  return a.scoreDetails.components.map(component => {
    let lines: string[];
    if (isRain(component)) {
      lines = component.key === 'rain' ? [7, 14, 30].map(days => `${days} dni: ${value(h?.[`rain${days}dMm` as keyof NonNullable<typeof h>] as number | undefined, 'mm')}`)
        : [`${value(h?.[`rain${rainDays(component.key)}dMm` as keyof NonNullable<typeof h>] as number | undefined, 'mm')} v zadnjih ${rainDays(component.key)} dneh`];
    } else if (component.key === 'temperature') {
      const days = a.speciesId === 'cantharellusCibarius' ? 14 : 20;
      lines = [`${value(days === 14 ? h?.avgTemp14dC : h?.avgTemp20dC, '°C')} povprečno v zadnjih ${days} dneh`];
    } else if (component.key === 'soilMoisture') {
      lines = [`0–7 cm: ${value(c?.soilMoisture0To7Cm, 'm³/m³', 3)}`, `7–28 cm: ${value(c?.soilMoisture7To28Cm, 'm³/m³', 3)}`];
    } else lines = [`ET₀ zadnjih 7 dni: ${value(h?.evapotranspiration7dMm, 'mm')}`, `Padavine zadnjih 7 dni: ${value(h?.rain7dMm, 'mm')}`];
    return { key: component.key, label: component.label, lines,
      contribution: `Prispevek k vremenski oceni: ${slNumber(component.weightedPoints, 1)} / ${slNumber(component.weight, 1)}` };
  });
}
