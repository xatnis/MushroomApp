import type { QuantityUnit } from './types';

export const slDateTime = (value: string | Date) =>
  new Intl.DateTimeFormat('sl-SI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export const slDate = (value: string | Date) =>
  new Intl.DateTimeFormat('sl-SI', { dateStyle: 'medium' }).format(new Date(value));

export const slNumber = (value: number, maximumFractionDigits = 1) =>
  new Intl.NumberFormat('sl-SI', { maximumFractionDigits }).format(value);

export function parseQuantity(value: string): number | undefined {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Količina mora biti veljavno nenegativno število.');
  return parsed;
}

export function formatQuantity(quantity?: number, unit?: QuantityUnit): string {
  if (quantity == null || !unit) return 'količina ni znana';
  const label = unit === 'pieces' ? (quantity === 1 ? 'kos' : 'kosov') : unit;
  return `${slNumber(quantity)} ${label}`;
}

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (value: number) => value * Math.PI / 180;
  const radius = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
