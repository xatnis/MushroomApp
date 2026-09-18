import type { MushroomSpecies } from './types';

export const speciesCatalogue: MushroomSpecies[] = [
  { id: 'unknown', nameSl: 'Neznana goba', aliases: ['neznana', 'neznano'], kind: 'unknown' },
  { id: 'other', nameSl: 'Drugo', aliases: ['druga', 'ostalo'], kind: 'custom' },
  { id: 'boletus-group', nameSl: 'Jurčki (skupina)', aliases: ['jurcek', 'jurčki', 'gobani'], kind: 'group' },
  { id: 'boletus-edulis', nameSl: 'Jesenski goban', scientificName: 'Boletus edulis', aliases: ['jurček', 'pravi goban'], kind: 'species' },
  { id: 'boletus-aereus', nameSl: 'Poletni goban', scientificName: 'Boletus aereus', aliases: ['črni goban'], kind: 'species' },
  { id: 'cantharellus-cibarius', nameSl: 'Navadna lisička', scientificName: 'Cantharellus cibarius', aliases: ['lisička', 'lisicka'], kind: 'species' },
  { id: 'macrolepiota-procera', nameSl: 'Orjaški dežnik', scientificName: 'Macrolepiota procera', aliases: ['marela', 'dežnik'], kind: 'species' },
  { id: 'craterellus-cornucopioides', nameSl: 'Črna trobenta', scientificName: 'Craterellus cornucopioides', aliases: ['mrtvaška trobenta'], kind: 'species' },
  { id: 'lactarius-deliciosus', nameSl: 'Užitna sirovka', scientificName: 'Lactarius deliciosus', aliases: ['sirovka'], kind: 'species' },
  { id: 'armillaria-group', nameSl: 'Štorovke (skupina)', aliases: ['štorovka', 'storovka'], kind: 'group' },
  { id: 'russula-group', nameSl: 'Golobice (skupina)', aliases: ['golobica'], kind: 'group' },
  { id: 'hydnum-repandum', nameSl: 'Rumeni ježek', scientificName: 'Hydnum repandum', aliases: ['ježek'], kind: 'species' },
  { id: 'amanita-muscaria', nameSl: 'Rdeča mušnica', scientificName: 'Amanita muscaria', aliases: ['mušnica'], kind: 'species' },
];

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sl').trim();
}

export function searchSpecies(query: string): MushroomSpecies[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return speciesCatalogue;
  return speciesCatalogue.filter((species) =>
    [species.nameSl, species.scientificName ?? '', ...species.aliases]
      .some((value) => normalizeSearch(value).includes(normalized)),
  );
}

export function speciesName(speciesId?: string, customName?: string): string {
  const custom = customName?.trim();
  if (custom) return custom;
  if (speciesId === 'other') return 'Drugo';
  return speciesCatalogue.find((item) => item.id === speciesId)?.nameSl ?? 'Neznana goba';
}
